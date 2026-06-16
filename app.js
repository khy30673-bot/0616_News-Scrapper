'use strict';

/* ============================================================
   듣는 뉴스 — 단계 1: 화면 사이 이동 + 진입 음성 안내
   ------------------------------------------------------------
   data-go="화면이름" 속성이 있는 요소를 누르면 해당 화면으로 전환.
   진입 화면을 누르면 환영 음성이 두 단계로 안내됩니다.
   더 풍부한 음성 흐름은 단계 2에서 추가됩니다.
   ============================================================ */

(function () {

  /* ----- TTS (음성 합성) -----
     브라우저 정책상 사용자의 첫 행동 이후에만 재생됩니다. */
  var TTS = {
    supported: 'speechSynthesis' in window,
    rate: 0.95,
    voice: null,
    warmedUp: false,

    init: function () {
      if (!this.supported) return;
      var self = this;
      function pickKoVoice() {
        var ko = window.speechSynthesis.getVoices().filter(function (v) {
          return v.lang && v.lang.toLowerCase().indexOf('ko') === 0;
        });
        if (ko.length) self.voice = ko[0];
      }
      pickKoVoice();
      window.speechSynthesis.onvoiceschanged = pickKoVoice;
    },

    /* 모바일 음성 합성 잠금 해제 — 사용자 첫 입력(클릭/키) 컨텍스트 안에서 호출되어야 효과.
       빈 utterance 하나를 곧바로 speak 호출하면 그 다음 speak들이 안정적으로 작동한다.
       단 한 번만 실행되고, 호출 자체에 setTimeout이나 cancel을 끼우지 않는다 — 이게 핵심.
       PC에는 영향 없음 (이미 잘 작동하는 흐름은 그대로 흘러감). */
    warmUp: function () {
      if (!this.supported || this.warmedUp) return;
      this.warmedUp = true;
      try {
        var u = new SpeechSynthesisUtterance('');
        u.volume = 0;
        u.rate = 1;
        window.speechSynthesis.speak(u);
      } catch (e) {}
    },

    /* text를 음성으로 읽고, 끝나면 onEnd 콜백 호출.
       이미 재생 중인 음성이 있으면 깨끗하게 끊고 새로 시작.
       단계 2A에서 PC·안드로이드 모두 안정적으로 작동했던 형태. */
    speak: function (text, onEnd) {
      if (!this.supported) {
        if (onEnd) setTimeout(onEnd, 400);
        return;
      }
      var self = this;
      window.speechSynthesis.cancel();
      /* cancel 직후 곧바로 speak하면 일부 브라우저에서 음성이 씹히므로
         아주 짧은 지연을 둔다. */
      setTimeout(function () {
        var u = new SpeechSynthesisUtterance(text);
        u.lang = 'ko-KR';
        u.rate = self.rate;
        /* voice 객체를 명시적으로 박는다 — 안드로이드 Chrome에서 한국어 음성을
           안정적으로 선택하게 한다. PC Chrome도 동일하게 잘 동작. */
        if (self.voice) u.voice = self.voice;
        u.onend = function () { if (onEnd) onEnd(); };
        u.onerror = function () { if (onEnd) onEnd(); };
        window.speechSynthesis.speak(u);
      }, 130);
    }
  };
  TTS.init();

  /* 모든 화면 요소를 미리 모아둔다 */
  var screens = {};
  document.querySelectorAll('.screen').forEach(function (el) {
    screens[el.dataset.screen] = el;
  });

  /* 현재 화면 (시작은 진입 화면) */
  var current = 'entry';

  /* 방문 경로 스택 — 백스페이스로 뒤로 갈 때 사용.
     goTo 호출마다 직전 화면이 쌓이고, goBack은 한 단계씩 꺼낸다. */
  var historyStack = [];

  /* 화면 전환 함수
     - 현재 화면을 숨기고 대상 화면을 보여준다
     - 직전 화면을 historyStack에 쌓는다 (단 같은 화면 연속 진입은 쌓지 않음)
     - 스크롤을 위로 올린다
     - 대상 화면의 첫 포커스 가능 요소로 포커스 이동
     - 화면별 진입·이탈 훅을 호출한다
     - options.fromBack=true면 뒤로가기 호출이므로 스택에 안 쌓음 */
  function goTo(name, options) {
    options = options || {};
    if (!screens[name] || name === current) return;

    /* 이탈 훅 */
    if (screenHooks[current] && screenHooks[current].onLeave) {
      screenHooks[current].onLeave();
    }

    /* 직전 화면을 스택에 쌓는다 (뒤로 가기 호출일 때는 제외) */
    if (!options.fromBack) {
      historyStack.push(current);
    }

    screens[current].hidden = true;
    screens[name].hidden = false;
    current = name;

    /* 새 화면 진입 시 스크롤 맨 위로 */
    var body = screens[name].querySelector('.screen-body');
    if (body) body.scrollTop = 0;

    /* 포커스를 새 화면의 제목 또는 본문 시작점으로 이동.
       스크린리더 사용자가 새 화면 진입을 인지할 수 있게 한다. */
    var focusTarget =
      screens[name].querySelector('.screen-title, .entry-title, .screen-body');
    if (focusTarget) {
      focusTarget.setAttribute('tabindex', '-1');
      focusTarget.focus({ preventScroll: true });
    }

    /* 진입 훅 — fromBack 정보를 함께 전달해서, 백스페이스로 돌아온 경우와
       첫 진입을 구분할 수 있게 한다. */
    if (screenHooks[name] && screenHooks[name].onEnter) {
      screenHooks[name].onEnter({ fromBack: !!options.fromBack });
    }
  }

  /* 백스페이스로 뒤로 가기.
     historyStack에서 직전 화면을 꺼내 그쪽으로 이동.
     화면 진입 안내(onEnter)가 자동으로 다시 재생돼서 "내가 지금 어디 있는지" 음성으로 알려준다.
     스택이 비어 있으면(진입 화면 등) 음성으로 안내만 한다. */
  function goBack() {
    if (historyStack.length === 0) {
      TTS.speak('처음 화면입니다. 더 이상 뒤로 갈 수 없습니다.');
      return;
    }
    var prev = historyStack.pop();
    goTo(prev, { fromBack: true });
  }

  /* 화면별 진입·이탈 동작 */
  var screenHooks = {};

  /* ============================================================
     키보드 입력 시스템 — 사용자가 명시적으로 누른 키만 동작을 일으킨다.
     - 스페이스: "다음 진행" (화면마다 정의)
     - 백스페이스: "이전 화면으로" (전역 동일)
     - 입력 필드(input/textarea)에서 키를 입력 중일 때만 통과
     ------------------------------------------------------------
     "오류 0에 가까운 일관성" 원칙:
     - 마우스 클릭은 거의 동작하지 않음 (포커스가 닿기만 해도 정보가 흐르는 문제 방지)
     - 모바일에서는 화면 어디든 단발 탭이 스페이스와 같은 역할 (백업 경로)
     - 응답 영역의 두 버튼만 직접 클릭 가능 (음성·키보드 둘 다 안 쓸 때의 최후 경로)
     ============================================================ */
  var KeyHandlers = {
    /* 화면별 키 동작 등록 — 등록 안 된 화면에서는 그 키가 무시됨 */
    spaceAction: {},
    arrowUpAction: {},
    arrowDownAction: {},
    enterAction: {},

    register: function (screenName, action) {
      this.spaceAction[screenName] = action;
    },
    registerArrowUp: function (screenName, action) {
      this.arrowUpAction[screenName] = action;
    },
    registerArrowDown: function (screenName, action) {
      this.arrowDownAction[screenName] = action;
    },
    registerEnter: function (screenName, action) {
      this.enterAction[screenName] = action;
    },

    triggerSpace: function () {
      var action = this.spaceAction[current];
      if (typeof action === 'function') {
        action();
      }
    },
    triggerArrowUp: function () {
      var action = this.arrowUpAction[current];
      if (typeof action === 'function') {
        action();
      }
    },
    triggerArrowDown: function () {
      var action = this.arrowDownAction[current];
      if (typeof action === 'function') {
        action();
      }
    },
    triggerEnter: function () {
      var action = this.enterAction[current];
      if (typeof action === 'function') {
        action();
      }
    }
  };

  /* 전역 키 리스너 — 모든 키 입력은 여기로 모인다. */
  document.addEventListener('keydown', function (e) {
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      /* 사용자 첫 입력 컨텍스트에서 TTS 워밍업 — 모바일 음성 합성 깨우기 */
      TTS.warmUp();
      KeyHandlers.triggerSpace();
      return;
    }
    if (e.key === 'Backspace') {
      e.preventDefault();
      TTS.warmUp();
      goBack();
      return;
    }
    /* 위/아래 화살표: 등록된 화면(현재는 results)에서만 동작.
       페이지 기본 스크롤 동작은 막아서 사용자 예측대로만 작동. */
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      TTS.warmUp();
      KeyHandlers.triggerArrowUp();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      TTS.warmUp();
      KeyHandlers.triggerArrowDown();
      return;
    }
    /* 엔터: 결정/확인 의미. 등록된 화면(현재는 results)에서만 동작. */
    if (e.key === 'Enter') {
      e.preventDefault();
      TTS.warmUp();
      KeyHandlers.triggerEnter();
      return;
    }
  });

  /* 전역 클릭 리스너 — 모바일·터치 백업 경로.
     단발 탭은 현재 화면의 스페이스 동작과 동일하게 작동.
     단 응답 영역의 두 버튼은 직접 동작 (음성 불가 + 화면 다른 영역 못 누르는 환경) */
  document.addEventListener('click', function (e) {
    /* 사용자 첫 입력 컨텍스트에서 TTS 워밍업 — 특히 iOS·모바일에서 첫 음성이 무음 되는 문제 회피 */
    TTS.warmUp();

    var responseBtn = e.target.closest('.response-btn');
    if (responseBtn) {
      e.stopPropagation();
      if (responseBtn.id === 'response-yes') proceedToMain();
      else if (responseBtn.id === 'response-no') declineWelcome();
      return;
    }

    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    KeyHandlers.triggerSpace();
  });

  /* ----- 진입 화면 → 결과 전환 환영 흐름 -----
     1. 화면 클릭 즉시 환영 + 권한 안내 + 스크린리더기 안내 (통합 멘트)
     2. 환영 멘트 끝 → 음성 인식 시작 시도 → 브라우저가 권한 팝업 표시
     3. 사용자가 허용 → "지금부터 듣겠습니다" 짧은 신호 →
        "오늘 날짜로 등록된 뉴스 기사를 확인하시겠습니까?" 질문이 자연스럽게 이어짐
     4. "네/예/응" 류로 답하면 곧바로 결과 화면으로 (중간 안내 없이)
     5. "나중에" 버튼이나 부정 응답이면 다시 묻기
     (단계 2B에서 "다른 것" 흐름 추가 예정) */
  var welcomeStarted = false;
  var entryEl = screens.entry;
  var responseArea = document.getElementById('response-area');
  var responsePrompt = document.getElementById('response-prompt');
  var btnYes = document.getElementById('response-yes');
  var btnNo = document.getElementById('response-no');

  /* VoiceInput 초기화: 안내는 TTS로, 결과는 응답 판정으로 */
  var voiceOk = VoiceInput.init(
    function announce(msg, onEnd) {
      /* 음성 인식 모듈이 화면 텍스트도 함께 갱신할 수 있도록 prompt 영역 사용 */
      responsePrompt.innerHTML = msg;
      TTS.speak(msg, onEnd);
    },
    function onResult(text) {
      /* 단계 2B에서 음성 인식 호출이 제거됨에 따라 이 콜백은 호출되지 않는다.
         미래의 LLM 화면 등에서 음성 인식을 다시 쓸 때를 위한 자리. */
    },
    function onError(kind) {
      /* 핵심 원칙: 사용자가 명확히 "네"라고 답하기 전엔
         시스템이 먼저 말하거나 다음 단계로 가지 않는다.
         일시적인 인식 실패는 침묵 처리 — 연속 듣기 모드 덕에
         음성 인식은 곧 자동으로 다시 켜진다. */
      if (kind === 'no-speech') {
        /* 음성이 안 들렸을 때 — 완전 침묵.
           음성 인식이 자동 재시작되어 사용자 답을 계속 기다린다. */
        return;
      } else if (kind === 'denied') {
        /* 권한 거부는 시스템 문제이므로 안내 필요 */
        showPrompt('마이크 권한이 거부되었습니다. 아래 "네, 시작하기" 버튼을 눌러 진행해 주세요.');
        TTS.speak('마이크 권한이 거부되었습니다. 아래 버튼을 눌러 진행해 주세요.');
      } else if (kind === 'no-mic') {
        showPrompt('마이크를 찾을 수 없습니다. 아래 버튼을 눌러 진행해 주세요.');
        TTS.speak('마이크를 찾을 수 없습니다. 아래 버튼을 눌러 진행해 주세요.');
      } else if (kind === 'unsupported') {
        showPrompt('이 브라우저는 음성 인식을 지원하지 않습니다. 아래 버튼을 눌러 진행해 주세요.');
      } else {
        /* 기타 일시 오류도 침묵 처리 — 자동 재시작에 맡김 */
        return;
      }
    }
  );

  function showPrompt(text) {
    responsePrompt.innerHTML = text;
    responseArea.hidden = false;
  }
  function showListeningPrompt(text) {
    responsePrompt.innerHTML = '<span class="listening-dot" aria-hidden="true"></span>' + text;
    responseArea.hidden = false;
  }

  function startWelcomeFlow() {
    if (welcomeStarted) return;
    welcomeStarted = true;

    /* 시작 안내 박스(CTA)와 보조 안내를 감춰서, 응답 영역이 그 자리를 차지하게 한다.
       사용자가 누른 위치에 곧바로 환영·질문이 떠올라 시선·손가락 흐름이 끊기지 않는다. */
    var ctaBox = entryEl.querySelector('.entry-cta');
    var subText = entryEl.querySelector('.entry-sub');
    if (ctaBox) ctaBox.hidden = true;
    if (subText) subText.hidden = true;

    /* 첫 클릭 즉시 환영 + 질문으로 진입 */
    askWelcomeQuestion();

    /* 안전망: 어떤 이유로든 음성 onEnd가 안 오면 5초 뒤 강제 진행 */
    setTimeout(function () {
      if (responseArea.hidden) askWelcomeQuestion();
    }, 5000);
  }

  function askWelcomeQuestion() {
    /* 환영 + 키 안내 (음성 인식·마이크 권한 호출은 단계 2B-B에서 제거됨).
       사용자는 스페이스(진행)와 백스페이스(거절/뒤로)로 모든 동작을 한다. */
    var welcome =
      '듣는 뉴스 스크랩에 오신 것을 환영합니다. ' +
      '스페이스 키로 다음으로 진행하시고, 백스페이스 키로 뒤로 돌아가실 수 있습니다.';

    /* 환영 멘트 끝나면 짧게 다음 단계 안내 — 사용자가 무엇을 해야 할지 명확히. */
    var nextStep =
      '오늘 날짜로 등록된 뉴스를 확인하시려면 스페이스 키를, ' +
      '그렇지 않다면 백스페이스 키를 눌러주세요.';

    /* 화면에 환영 안내 표시 */
    showPrompt(welcome);

    /* 환영 멘트 → 키 안내 음성 → 침묵하며 사용자 답을 기다림.
       사용자가 스페이스 누르면 진입 화면의 KeyHandlers가 proceedToMain() 호출.
       사용자가 백스페이스 누르면 goBack() 호출 (단계 C에서 거절 동작으로 다듬을 예정). */
    TTS.speak(welcome, function () {
      setTimeout(function () {
        showListeningPrompt(nextStep);
        TTS.speak(nextStep);
      }, 400);
    });
  }
  /* 단계 2B-C에서 정리: startListeningForYes, TODAY_NEWS_QUESTION, 1분 대기 타이머,
     reaskTodayNews, handleUserResponse 함수들은 음성 인식 흐름 제거에 따라 삭제됨.
     미래의 LLM 화면에서 음성 인식을 다시 쓸 때는 voice-input.js를 새로 호출하면 된다. */


  /* 사용자가 진입에서 "네"(스페이스) 답하면 결과 화면으로 직행한다.
     중간 안내 멘트는 두지 않는다 — 사용자는 답하자마자 결과를 듣기 시작한다. */
  function proceedToMain() {
    VoiceInput.stop();
    responseArea.hidden = true;
    goTo('results');
  }

  function declineWelcome() {
    VoiceInput.stop();
    showPrompt('나중에 다시 시도해 주세요. 화면을 다시 누르면 시작합니다.');
    TTS.speak('나중에 다시 시도해 주세요.');
    welcomeStarted = false;
    responseArea.hidden = true;
    /* CTA·sub 복원 — 다시 누르면 시작할 수 있다는 안내를 살림 */
    var ctaBox = entryEl.querySelector('.entry-cta');
    var subText = entryEl.querySelector('.entry-sub');
    if (ctaBox) ctaBox.hidden = false;
    if (subText) subText.hidden = false;
  }

  /* 진입 화면 자동 포커스 — 페이지가 열리면 진입 화면에 포커스 (스크린리더가 곧장 안내). */
  setTimeout(function () {
    if (current === 'entry' && !welcomeStarted) {
      entryEl.focus({ preventScroll: true });
    }
  }, 100);

  /* ============================================================
     화면별 스페이스 동작 등록 — "스페이스 = 다음 진행"의 의미를 각 화면에서 정의
     ============================================================ */

  /* 진입 화면: 환영 흐름이 시작되지 않았다면 시작. 시작된 뒤엔 "네"로 진행(응답 영역 표시 중일 때). */
  KeyHandlers.register('entry', function () {
    if (!welcomeStarted) {
      startWelcomeFlow();
    } else if (!responseArea.hidden) {
      /* 환영 흐름이 진행 중이고 응답 영역이 떠 있으면 — 사용자가 "네"로 진행한 것으로 해석.
         음성 인식이 막혀 있거나 사용자가 음성 대신 키를 쓰고 싶을 때의 백업 경로. */
      proceedToMain();
    }
  });

  /* ============================================================
     화면별 스페이스 동작 등록 (진입 화면)
     키보드 시스템과 전역 핸들러는 위쪽에 정의돼 있음.
     ============================================================ */

  /* 진입 화면: 환영 흐름이 시작되지 않았다면 시작.
     시작된 뒤엔 응답 영역이 떠 있으면 "네"로 진행 (음성 백업 경로). */
  KeyHandlers.register('entry', function () {
    if (!welcomeStarted) {
      startWelcomeFlow();
    } else if (!responseArea.hidden) {
      proceedToMain();
    }
  });


  /* 진입 화면 훅 — 다른 화면으로 떠날 때 1분 타이머와 음성 인식을 안전하게 정리.
     proceedToMain/declineWelcome이 이미 이를 하지만, 다른 경로로 이탈할 때도 안전망. */
  screenHooks.entry = {
    /* 진입 화면 진입 — 첫 진입이든 백스페이스 복귀든 환영 흐름을 처음 상태로 리셋.
       사용자가 명시적으로 스페이스를 눌러야 환영 흐름이 시작되도록 한다. */
    onEnter: function (info) {
      /* 진행 중인 음성·마이크 정리 (백스페이스 복귀 시 잔여 동작 방지) */
      VoiceInput.stop();
      if (window.speechSynthesis) window.speechSynthesis.cancel();

      /* 환영 흐름 상태 리셋 — 다시 누르면 처음부터 시작 */
      welcomeStarted = false;
      responseArea.hidden = true;

      /* CTA 박스와 보조 안내 복원 — "화면 아무 곳이나 눌러 시작하기"가 다시 보이게 */
      var ctaBox = entryEl.querySelector('.entry-cta');
      var subText = entryEl.querySelector('.entry-sub');
      if (ctaBox) ctaBox.hidden = false;
      if (subText) subText.hidden = false;

      /* 백스페이스로 돌아온 경우에만 짧은 안내 — 사용자에게 "지금 어디인지" 알려줌.
         첫 진입(페이지 로드 직후)에는 안내가 필요 없다 (사용자가 자연스럽게 스페이스를 누름). */
      if (info && info.fromBack) {
        TTS.speak('처음 화면입니다. 다시 시작하시려면 스페이스 키를 눌러 주세요.');
      }
    },
    onLeave: function () {
      VoiceInput.stop();
      if (window.speechSynthesis) window.speechSynthesis.cancel();
    }
  };

  /* 메인(마이크 토글) 화면은 단계 2B-A에서 제거됨 — screenHooks.main 등록 없음 */

  /* ============================================================
     가상 기사 데이터 (시뮬레이션용)
     ------------------------------------------------------------
     포트폴리오 프로젝트라 실제 RSS·API 안 씀. 4건의 제목·전문을 직접 정의.
     index.html의 결과 화면 카드 순서와 동일한 순서로 배치.
     detail 화면이 window.__selectedArticleIndex로 이 배열을 참조해서 표시.
     ============================================================ */
  var ARTICLES = [
    {
      title: '한국은행, 기준금리 동결 결정',
      body: '한국은행 금융통화위원회는 오늘 회의에서 기준금리를 현 수준인 연 3.5퍼센트로 유지하기로 만장일치 결정했습니다. ' +
            '위원회는 소비자물가 상승률이 목표 범위에 근접하고 있으나, 가계부채 증가세와 환율 변동성을 감안할 때 신중한 기조가 필요하다고 설명했습니다. ' +
            '한편 위원회는 향후 통화정책 방향에 대해 물가, 성장, 금융안정 흐름을 종합적으로 보면서 결정하겠다고 밝혔습니다. ' +
            '이번 결정으로 기준금리는 다섯 차례 연속 동결되었습니다.'
    },
    {
      title: '전문가들, 연내 금리 인하 시점 전망 엇갈려',
      body: '국내 주요 경제 전문가들 사이에서 올해 안에 기준금리가 인하될지에 대한 전망이 엇갈리고 있습니다. ' +
            '일부 전문가는 물가 안정세가 뚜렷해지면 4분기 중에 인하가 가능하다고 보는 반면, ' +
            '다른 전문가들은 가계부채와 부동산 시장 상황을 고려할 때 내년 상반기까지 동결이 이어질 것으로 전망했습니다. ' +
            '특히 미국 연방준비제도의 정책 방향이 한국은행의 결정에 큰 영향을 미칠 것이라는 분석이 우세합니다.'
    },
    {
      title: '기준금리 동결에 부동산·대출 시장 영향 주목',
      body: '기준금리 동결 결정에 따라 부동산 시장과 대출 시장의 향방에 관심이 모이고 있습니다. ' +
            '시장 전문가들은 금리 동결이 주택 매수 심리에 단기적으로 안정 신호를 줄 수 있다고 분석했습니다. ' +
            '다만 대출 한도와 총부채원리금상환비율 규제는 그대로 유지되고 있어, ' +
            '실제 매수 여력 확대는 제한적일 것이라는 의견도 나오고 있습니다. ' +
            '은행권 주택담보대출 금리는 당분간 현 수준에서 큰 변동 없이 움직일 것으로 보입니다.'
    },
    {
      title: '국회 기재위, 통화정책 점검 청문회 일정 논의',
      body: '국회 기획재정위원회는 이번 달 안에 통화정책 점검 청문회를 개최하는 방안을 논의했습니다. ' +
            '여야 의원들은 한국은행 총재를 출석시켜 최근의 금리 결정 배경과 향후 통화정책 운영 방향에 대해 질의할 계획입니다. ' +
            '특히 가계부채 관리, 환율 안정, 물가 대응 등 주요 현안에 대한 종합적인 점검이 이뤄질 전망입니다. ' +
            '구체적인 일정은 여야 간 협의를 거쳐 다음 주 중 확정될 예정입니다.'
    }
  ];

  /* ============================================================
     LLM 대본 데이터 (단계 D-5)
     ------------------------------------------------------------
     각 기사 인덱스에 대응하는 두 차례의 질문·답변.
     ARTICLES 배열과 같은 순서·인덱스를 유지한다.
     사용자에게 들리는 멘트엔 "연극", "시뮬레이션", "예시" 같은 단어가 절대 없다 — 몰입 보호.
     ============================================================ */
  var LLM_SCRIPTS = [
    /* 0번 기사: 한국은행, 기준금리 동결 결정 */
    [
      { who: 'user', text: '이번 기준금리 동결이 평범한 가계의 대출 부담에는 어떤 영향이 있을까요?' },
      { who: 'llm',  text: '기준금리가 동결되면 시중은행의 대출 금리도 큰 변동 없이 유지될 가능성이 높습니다. ' +
                            '다만 변동금리 대출을 사용 중이신 분들은 시장 상황에 따라 미세하게 움직일 수 있으니, ' +
                            '본인의 대출 조건을 한 번 점검해 보시면 도움이 됩니다.' },
      { who: 'user', text: '그러면 앞으로 금리가 내릴 가능성은 얼마나 될까요?' },
      { who: 'llm',  text: '향후 금리 방향은 물가 안정세, 가계부채 흐름, 그리고 환율 같은 요인에 따라 결정됩니다. ' +
                            '한국은행은 이러한 지표들을 종합적으로 보면서 결정하겠다고 밝혔으며, ' +
                            '시장에서는 연말이나 내년 상반기에 인하 가능성을 두고 의견이 나뉘고 있습니다.' }
    ],
    /* 1번 기사: 전문가들, 연내 금리 인하 시점 전망 엇갈려 */
    [
      { who: 'user', text: '전문가들의 전망이 왜 이렇게 갈리는 건가요?' },
      { who: 'llm',  text: '경제 지표를 해석하는 관점이 다르기 때문입니다. ' +
                            '물가 안정세에 무게를 두는 쪽은 빠른 인하 가능성을 보고, ' +
                            '가계부채와 부동산 시장 안정에 무게를 두는 쪽은 신중한 접근이 필요하다고 봅니다.' },
      { who: 'user', text: '미국 연방준비제도의 정책이 왜 그렇게 중요한가요?' },
      { who: 'llm',  text: '한국과 미국의 금리 차이가 커지면 환율과 자본 흐름에 영향을 줄 수 있습니다. ' +
                            '한국은행은 자체 경제 상황뿐 아니라 미국의 결정도 함께 고려하면서 정책을 운영하기 때문에, ' +
                            '연방준비제도의 방향이 국내 금리 결정에도 영향을 미칩니다.' }
    ],
    /* 2번 기사: 기준금리 동결에 부동산·대출 시장 영향 주목 */
    [
      { who: 'user', text: '금리 동결이 주택 구매를 고민 중인 사람에게는 어떤 의미인가요?' },
      { who: 'llm',  text: '단기적으로는 대출 금리가 크게 오르지 않을 것이라는 안정 신호로 볼 수 있습니다. ' +
                            '다만 대출 한도와 총부채원리금상환비율 규제는 그대로이기 때문에, ' +
                            '실제 매수 여력이 크게 늘어나지는 않을 가능성이 있습니다.' },
      { who: 'user', text: '주택담보대출 금리는 앞으로 어떻게 움직일까요?' },
      { who: 'llm',  text: '기준금리 동결이 이어지는 동안에는 주택담보대출 금리도 큰 변동 없이 움직일 것으로 예상됩니다. ' +
                            '다만 은행별 가산금리 조정이나 시장 자금 사정에 따라 미세한 차이는 있을 수 있으니, ' +
                            '여러 은행의 조건을 비교해 보시는 것이 좋습니다.' }
    ],
    /* 3번 기사: 국회 기재위, 통화정책 점검 청문회 일정 논의 */
    [
      { who: 'user', text: '통화정책 점검 청문회에서는 주로 어떤 내용이 다뤄지나요?' },
      { who: 'llm',  text: '최근의 금리 결정 배경과 향후 통화정책 방향, 그리고 가계부채와 환율 같은 주요 현안에 대한 질의가 이뤄집니다. ' +
                            '국회의원들이 한국은행 총재에게 직접 질문하고, 정책의 책임성과 투명성을 점검하는 자리입니다.' },
      { who: 'user', text: '일반 시민이 청문회 내용을 알면 어떤 도움이 되나요?' },
      { who: 'llm',  text: '통화정책이 가계 살림과 자산 관리에 어떤 영향을 미치는지 이해하는 데 도움이 됩니다. ' +
                            '청문회에서 나온 설명을 통해 금리, 환율, 물가 같은 경제 지표가 왜 그렇게 움직였는지를 ' +
                            '맥락과 함께 파악할 수 있습니다.' }
    ]
  ];

  /* ============================================================
     결과 화면 — 진입 시 안내만 + 사용자 스페이스로 한 건씩 진행
     ------------------------------------------------------------
     단계 2B-2에서 자동 재생 제거됨. 사용자가 스페이스를 누를 때만 다음 기사 제목이 들린다.
     백스페이스는 전역 핸들러가 goBack()을 호출 — 진입 화면으로 복귀.
     ============================================================ */
  var ResultsScreen = {
    cancelled: false,
    headlines: [],
    focusIndex: -1,
    atEnd: false,        // 마지막 기사 이후 상태 (스페이스 또 누르면 "마지막 기사입니다" 안내)

    onEnter: function () {
      this.cancelled = false;

      /* DOM에서 현재 표시된 결과 화면의 헤드라인을 모두 수집 */
      var headlines = [];
      var cards = screens.results.querySelectorAll('.article-card .card-headline');
      cards.forEach(function (el) { headlines.push(el.textContent.trim()); });
      this.headlines = headlines;
      this.focusIndex = -1;  /* -1 = 아직 어느 항목도 선택 안 됨 */
      this.atEnd = false;

      /* 진입 안내만 음성으로 — 그 후 침묵, 사용자가 키를 누를 때까지 대기.
         "네 건"으로 한글 수사 사용 — 한국어 TTS가 "4건"을 "사건"으로 읽는 문제 회피.
         가상 데이터가 항상 4건이므로 명시적으로 박아둠. 미래에 건수 바뀌면 이곳을 손봐야 함.
         스페이스·화살표·엔터 세 키 모두 사용법 안내 — 시각에 의존하지 않는 사용자를 위해 매번 안내. */
      var intro = '오늘의 뉴스 기사는 총 네 건입니다. ' +
                  '스페이스 키 또는 위, 아래 화살표 키를 통해 해당 기사 위치로 이동할 수 있습니다. ' +
                  '위치로 이동 후, 엔터를 누르면 해당 기사를 들을 수 있습니다.';
      TTS.speak(intro);
    },

    /* 사용자가 스페이스 또는 아래 화살표를 누를 때 호출됨.
       focusIndex가 -1이면 첫 기사부터, 그 외엔 다음 기사로 진행. */
    nextItem: function () {
      if (!this.headlines || this.headlines.length === 0) return;

      /* 이미 마지막 기사 안내가 떴고 사용자가 또 누르면 다시 같은 안내만 */
      if (this.atEnd) {
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        TTS.speak('마지막 기사입니다.');
        return;
      }

      var nextIdx = this.focusIndex + 1;

      /* 마지막 기사를 이미 들었고 또 누른 경우 — 안내 한 줄, 침묵 */
      if (nextIdx >= this.headlines.length) {
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        this.atEnd = true;
        TTS.speak('마지막 기사입니다.');
        return;
      }

      this.speakFocusedItem(nextIdx);
    },

    /* 사용자가 위 화살표를 누를 때 호출됨 — 이전 기사로 이동.
       첫 기사 위로 가려고 하면 "첫 번째 기사입니다" 안내, 포커스 변경 없음. */
    prevItem: function () {
      if (!this.headlines || this.headlines.length === 0) return;

      /* 마지막 기사 안내 상태(atEnd)였다면 위로 가는 순간 해제 — 다시 일반 탐색 모드 */
      if (this.atEnd) {
        this.atEnd = false;
        /* atEnd 상태에선 focusIndex가 마지막 기사를 가리킴.
           위로 한 칸 가려면 마지막 기사 그대로 두는 게 자연스러움 (이미 마지막 위치에 있음).
           대신 사용자가 위 화살표를 누른 의도 — "이전 기사로" — 를 따라 한 칸 위로. */
      }

      /* 아직 어느 기사도 선택 안 된 상태(focusIndex=-1)에서 위 화살표 — 안내만 */
      if (this.focusIndex <= 0) {
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        TTS.speak('첫 번째 기사입니다.');
        return;
      }

      var prevIdx = this.focusIndex - 1;
      this.speakFocusedItem(prevIdx);
    },

    speakFocusedItem: function (i) {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      this.focusIndex = i;
      this.highlightCard(i);
      var text = (i + 1) + '번째 기사. ' + this.headlines[i] + '.';
      TTS.speak(text);
    },

    /* 사용자가 엔터를 눌렀을 때 호출됨 — 현재 포커스된 기사를 결정.
       포커스 없는 상태(focusIndex=-1)에서는 안내만 하고 진행 안 함.
       단계 D-2 범위: detail 화면으로 이동만. 화면 내용은 D-3에서 채울 예정. */
    selectFocused: function () {
      if (this.focusIndex < 0) {
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        TTS.speak('먼저 스페이스 키 또는 화살표 키로 기사를 선택해 주세요.');
        return;
      }
      /* 포커스된 기사 인덱스를 detail 화면이 알 수 있도록 전역에 기록.
         단계 D-3에서 detail 화면이 이 정보를 읽어 해당 기사 전문을 표시할 예정. */
      window.__selectedArticleIndex = this.focusIndex;
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      goTo('detail');
    },

    /* 현재 포커스된 카드에 시각적 표시 (저시력 사용자가 위치를 인지) */
    highlightCard: function (i) {
      var cards = screens.results.querySelectorAll('.article-card');
      cards.forEach(function (c, idx) {
        if (idx === i) c.classList.add('focused');
        else c.classList.remove('focused');
      });
    },

    onLeave: function () {
      this.cancelled = true;
      this.focusIndex = -1;
      this.atEnd = false;
      if (window.speechSynthesis) window.speechSynthesis.cancel();
    }
  };

  screenHooks.results = {
    onEnter: function () { ResultsScreen.onEnter(); },
    onLeave: function () { ResultsScreen.onLeave(); }
  };

  /* ============================================================
     기사 상세 화면 — 선택된 기사의 전문을 음성으로 읽어준다
     ------------------------------------------------------------
     단계 D-3 흐름:
     1. ResultsScreen.selectFocused()가 window.__selectedArticleIndex 설정 후 goTo('detail')
     2. DetailScreen.onEnter()가 그 인덱스로 ARTICLES 배열 참조해 화면·음성 갱신
     3. 진입 안내 → 잠시 후 전문 음성 시작
     4. 전문 끝나면 안내 영역 표시 + "기사 읽기를 완료했습니다..." 안내 음성
     5. 사용자가 백스페이스로 결과 화면 복귀 (전역 핸들러가 처리)
     ============================================================ */
  var DetailScreen = {
    cancelled: false,

    onEnter: function () {
      this.cancelled = false;
      var self = this;

      /* 선택된 기사 인덱스 확보 — 안전망: 없으면 0번째로 */
      var idx = window.__selectedArticleIndex;
      if (typeof idx !== 'number' || idx < 0 || idx >= ARTICLES.length) {
        idx = 0;
      }
      var article = ARTICLES[idx];

      /* 화면 갱신: 제목과 전문 */
      var headlineEl = document.getElementById('detail-headline');
      var bodyEl = document.getElementById('detail-body');
      var endNoticeEl = document.getElementById('detail-end-notice');
      var endNoticeTextEl = endNoticeEl ? endNoticeEl.querySelector('.end-notice-text') : null;
      if (headlineEl) headlineEl.textContent = article.title;
      if (bodyEl) bodyEl.textContent = article.body;
      /* 끝 안내 영역은 일단 숨김 — 전문 읽기 완료 후 표시 */
      if (endNoticeEl) endNoticeEl.hidden = true;

      /* 진입 안내 음성 → 짧은 숨 → 전문 음성 → 끝 안내 음성·영역.
         엔터는 detail 화면 진입 직후부터 언제든 LLM 이동에 작동 — readyForLLM 같은
         단계별 플래그 없음. 사용자가 듣다가 호기심이 생기면 곧바로 엔터로 진입. */
      var introMsg = '전체 기사를 읽어드리겠습니다. ' +
                     '듣기를 중단하시려면 백스페이스 키를, ' +
                     'LLM과 대화하시려면 엔터를 눌러주세요.';
      var endMsg = '기사 읽기를 완료했습니다. ' +
                   '이전 화면으로 돌아가려면 백스페이스를, ' +
                   'LLM과 기사 내용 관련 대화를 나누고 싶다면 엔터를 눌러주세요.';
      var endMsgHTML = '기사 읽기를 완료했습니다.<br/>' +
                       '이전 화면으로 돌아가려면 <strong>백스페이스</strong>를,<br/>' +
                       'LLM과 기사 내용 관련 대화를 나누고 싶다면 <strong>엔터</strong>를 눌러주세요.';

      TTS.speak(introMsg, function () {
        if (self.cancelled) return;
        /* 진입 안내와 전문 사이 짧은 숨 — 사용자가 안내를 소화할 시간 */
        setTimeout(function () {
          if (self.cancelled) return;
          TTS.speak(article.body, function () {
            if (self.cancelled) return;
            /* 전문이 끝나면 안내 영역 표시 + 안내 음성 */
            setTimeout(function () {
              if (self.cancelled) return;
              if (endNoticeEl) endNoticeEl.hidden = false;
              if (endNoticeTextEl) endNoticeTextEl.innerHTML = endMsgHTML;
              TTS.speak(endMsg);
            }, 400);
          });
        }, 600);
      });
    },

    /* 사용자가 detail 화면에서 엔터를 눌렀을 때 호출됨.
       전문 재생 중·끝난 후 무관하게 언제든 LLM 화면으로 이동.
       단계 D-6: 호기심의 순간을 잡기 위해 readyForLLM 조건 제거. */
    selectLLM: function () {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      goTo('llm');
    },

    onLeave: function () {
      this.cancelled = true;
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      /* 끝 안내 영역도 다음 진입을 위해 초기화 (숨김) */
      var endNoticeEl = document.getElementById('detail-end-notice');
      if (endNoticeEl) endNoticeEl.hidden = true;
    }
  };

  screenHooks.detail = {
    onEnter: function () { DetailScreen.onEnter(); },
    onLeave: function () { DetailScreen.onLeave(); }
  };

  /* ============================================================
     LLM 가상 시연 화면 (단계 D-5)
     ------------------------------------------------------------
     실제 LLM 연결 없음. 두 인물(사용자/LLM)이 미리 정의된 대본대로 대화하는 흐름을
     음성+화면 버블로 보여준다.

     사용자에게 들리는 멘트엔 "연극"·"시연"·"시뮬레이션" 같은 단어가 절대 없다 — 몰입 보호.

     흐름:
     1. 진입 안내 음성 ("LLM 사이트에 접속하였습니다. 대화를 시작할 수 있습니다.")
     2. 짧은 숨 → 첫 대사 (사용자 질문) 표시 + "사용자 질문입니다" 안내 + 본문 음성
     3. 다음 대사 (LLM 답변) 표시 + "LLM 답변입니다" 안내 + 본문 음성
     4. ... 대본 끝까지
     5. 끝 안내 영역 표시 + 안내 음성
     6. 침묵, 사용자가 백스페이스로 결정
     ============================================================ */
  var LLMScreen = {
    cancelled: false,

    onEnter: function () {
      this.cancelled = false;
      var self = this;

      /* 어느 기사의 대본을 쓸지 — DetailScreen에서 설정된 인덱스 활용 */
      var idx = window.__selectedArticleIndex;
      if (typeof idx !== 'number' || idx < 0 || idx >= LLM_SCRIPTS.length) {
        idx = 0;
      }
      var article = ARTICLES[idx];
      var script = LLM_SCRIPTS[idx];

      /* 화면 갱신: 기사 맥락 + 대화 영역 초기화 + 끝 안내 숨김 */
      var contextTitleEl = document.getElementById('llm-context-title');
      var conversationEl = document.getElementById('llm-conversation');
      var endNoticeEl = document.getElementById('llm-end-notice');
      if (contextTitleEl) contextTitleEl.textContent = article.title;
      if (conversationEl) conversationEl.innerHTML = '';
      if (endNoticeEl) endNoticeEl.hidden = true;

      /* 진입 안내 음성 → 대본 차례로 재생 */
      var introMsg = 'LLM 사이트에 접속하였습니다. 대화를 시작할 수 있습니다.';
      var endMsg = '대화가 끝났습니다. 이전 화면으로 돌아가려면 백스페이스를 눌러주세요.';

      TTS.speak(introMsg, function () {
        if (self.cancelled) return;
        setTimeout(function () {
          if (self.cancelled) return;
          self.playScript(script, 0, function onScriptEnd() {
            if (self.cancelled) return;
            setTimeout(function () {
              if (self.cancelled) return;
              if (endNoticeEl) endNoticeEl.hidden = false;
              TTS.speak(endMsg);
            }, 500);
          });
        }, 700);
      });
    },

    /* 대본의 i번째 대사부터 차례로 재생. 끝나면 onEnd 호출. */
    playScript: function (script, i, onEnd) {
      if (this.cancelled) return;
      if (i >= script.length) {
        if (typeof onEnd === 'function') onEnd();
        return;
      }
      var self = this;
      var line = script[i];

      /* 화면에 버블 추가 */
      this.appendBubble(line.who, line.text);

      /* 음성: 누가 말하는지 안내 + 본문.
         두 음성을 따로 호출하지 않고 한 utterance로 — 자연스러운 흐름. */
      var label = (line.who === 'user') ? '사용자 질문입니다.' : 'LLM 답변입니다.';
      var fullText = label + ' ' + line.text;

      TTS.speak(fullText, function () {
        if (self.cancelled) return;
        /* 대사 사이 짧은 숨 — 사용자가 내용을 소화할 시간 */
        setTimeout(function () {
          if (self.cancelled) return;
          self.playScript(script, i + 1, onEnd);
        }, 500);
      });
    },

    /* 대화 영역에 버블 추가 — 사용자/LLM 구분 */
    appendBubble: function (who, text) {
      var conversationEl = document.getElementById('llm-conversation');
      if (!conversationEl) return;
      var bubble = document.createElement('div');
      bubble.className = 'llm-bubble ' + who;
      var label = document.createElement('span');
      label.className = 'bubble-label';
      label.textContent = (who === 'user') ? '사용자' : 'LLM';
      var textEl = document.createElement('p');
      textEl.className = 'bubble-text';
      textEl.textContent = text;
      bubble.appendChild(label);
      bubble.appendChild(textEl);
      conversationEl.appendChild(bubble);
      /* 새 버블이 보이도록 화면 스크롤 — screen-body 컨테이너 안에서 */
      var body = conversationEl.closest('.screen-body');
      if (body) body.scrollTop = body.scrollHeight;
    },

    onLeave: function () {
      this.cancelled = true;
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      /* 다음 진입을 위해 대화 영역과 끝 안내 초기화 */
      var conversationEl = document.getElementById('llm-conversation');
      var endNoticeEl = document.getElementById('llm-end-notice');
      if (conversationEl) conversationEl.innerHTML = '';
      if (endNoticeEl) endNoticeEl.hidden = true;
    }
  };

  screenHooks.llm = {
    onEnter: function () { LLMScreen.onEnter(); },
    onLeave: function () { LLMScreen.onLeave(); }
  };

  /* ============================================================
     화면별 스페이스 동작 등록 (메인·결과·기타)
     ============================================================ */

  /* 메인(마이크 토글) 화면 제거됨 — KeyHandlers 등록 없음 */

  /* 결과 화면 키 동작:
     - 스페이스 = 다음 항목 (아래 화살표와 같은 의미)
     - 아래 화살표 = 다음 항목
     - 위 화살표 = 이전 항목
     - 엔터 = 현재 포커스된 기사 결정 → detail 화면으로 */
  KeyHandlers.register('results', function () {
    ResultsScreen.nextItem();
  });
  KeyHandlers.registerArrowDown('results', function () {
    ResultsScreen.nextItem();
  });
  KeyHandlers.registerArrowUp('results', function () {
    ResultsScreen.prevItem();
  });
  KeyHandlers.registerEnter('results', function () {
    ResultsScreen.selectFocused();
  });

  /* detail 화면 키 동작:
     - 엔터 = 언제든 LLM 화면으로 이동 (전문 재생 중·끝난 후 무관).
       단계 D-6에서 호기심의 순간을 잡기 위해 시점 조건 제거.
     - 백스페이스 = 전역 핸들러가 goBack() 호출 → 결과 화면 복귀 (자동 처리).
     - 스페이스, 화살표 = 등록 안 함, 무동작. */
  KeyHandlers.registerEnter('detail', function () {
    DetailScreen.selectLLM();
  });

  /* 스크랩·설정 화면: 단계 2C에서 정의 예정.
     지금은 스페이스를 눌러도 동작 없음 (등록되지 않은 화면은 무시).
     단, 화면 이탈 시 진행 중인 음성은 정리. detail은 위에서 별도 정의됐으니 제외. */
  ['scraps', 'settings'].forEach(function (s) {
    screenHooks[s] = screenHooks[s] || {};
    screenHooks[s].onLeave = function () {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
    };
  });

  /* Main.init() 호출 제거 — 메인 화면 자체가 제거됐다. */

  /* VoiceInput의 결과를 진입 환영 흐름으로 라우팅.
     단계 2B-A에서 메인 화면 제거됨에 따라 라우팅 분기도 단순해짐. */
  var originalOnResult = VoiceInput.onResult;
  VoiceInput.onResult = function (text) {
    if (originalOnResult) originalOnResult(text);
  };

  /* 스크랩 토글 (단계 1: 시각적 상태만 토글) */
  var scrapToggle = document.getElementById('scrap-toggle');
  if (scrapToggle) {
    var scrapped = false;
    scrapToggle.addEventListener('click', function () {
      scrapped = !scrapped;
      scrapToggle.querySelector('span').textContent = scrapped ? '★' : '☆';
      scrapToggle.setAttribute('aria-label', scrapped ? '스크랩됨' : '스크랩하기');
    });
  }

  /* 설정 화면의 토글 버튼들 (단계 1: 시각적 상태만) */
  document.querySelectorAll('.toggle').forEach(function (t) {
    t.addEventListener('click', function () {
      var on = t.getAttribute('aria-checked') === 'true';
      t.setAttribute('aria-checked', !on);
      t.classList.toggle('on', !on);
      t.textContent = !on ? '켜짐' : '꺼짐';
      /* aria-label도 동기화 */
      var name = t.getAttribute('aria-label').replace(/켜짐|꺼짐/, '').trim();
      t.setAttribute('aria-label', name + ' ' + (!on ? '켜짐' : '꺼짐'));
    });
  });
})();

