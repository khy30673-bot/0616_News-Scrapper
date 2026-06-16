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

    register: function (screenName, action) {
      this.spaceAction[screenName] = action;
    },
    registerArrowUp: function (screenName, action) {
      this.arrowUpAction[screenName] = action;
    },
    registerArrowDown: function (screenName, action) {
      this.arrowDownAction[screenName] = action;
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

      /* 진입 안내만 음성으로 — 그 후 침묵, 사용자가 스페이스 누를 때까지 대기 */
      var intro = '오늘 뉴스 ' + headlines.length + '건을 찾았습니다. ' +
                  '스페이스 키를 누르면 첫 번째 기사 제목부터 차례로 들으실 수 있습니다.';
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
     화면별 스페이스 동작 등록 (메인·결과·기타)
     ============================================================ */

  /* 메인(마이크 토글) 화면 제거됨 — KeyHandlers 등록 없음 */

  /* 결과 화면 키 동작:
     - 스페이스 = 다음 항목 (아래 화살표와 같은 의미)
     - 아래 화살표 = 다음 항목
     - 위 화살표 = 이전 항목 */
  KeyHandlers.register('results', function () {
    ResultsScreen.nextItem();
  });
  KeyHandlers.registerArrowDown('results', function () {
    ResultsScreen.nextItem();
  });
  KeyHandlers.registerArrowUp('results', function () {
    ResultsScreen.prevItem();
  });

  /* 상세·스크랩·설정 화면: 단계 2B·2C에서 정의 예정.
     지금은 스페이스를 눌러도 동작 없음 (등록되지 않은 화면은 무시). */

  /* 상세·스크랩·설정의 onLeave에서도 음성 정리 (단계 2B·2C에서 onEnter 추가) */
  ['detail', 'scraps', 'settings'].forEach(function (s) {
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

