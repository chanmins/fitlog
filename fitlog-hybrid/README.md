# FitLog 하이브리드 앱

FitLog PWA 를 감싸는 iOS·Android 네이티브 껍데기입니다. 화면은 지금까지의 웹
코드 그대로 쓰고, **웹이 할 수 없던 한 가지 — 앱이 꺼져 있는 동안에도 정확한
시각에 울리는 휴식 타이머 —** 만 네이티브가 맡습니다.

```
fitlog-main/          ← 웹 원본 (이 폴더가 진실입니다. 사본을 만들지 않습니다)
fitlog-hybrid/
├─ android/           Android 앱 (Kotlin, Gradle)
├─ ios/               iOS 앱 (Swift, Xcode)
├─ scripts/           웹 파일을 Android assets 로 복사하는 스크립트
├─ store/             앱스토어용 아이콘 (512 / 1024)
└─ docs/              아키텍처 · 개발 · 테스트 문서
```

## 5분 안에 돌려 보기

**Android** (이 PC 에서 바로 됩니다)

```powershell
cd fitlog-hybrid
powershell -ExecutionPolicy Bypass -File scripts\sync-web.ps1
# Android Studio 로 fitlog-hybrid\android 폴더를 엽니다 → Run
```

**iOS** (맥과 Xcode 가 필요합니다)

```bash
open fitlog-hybrid/ios/FitLog.xcodeproj
# Signing & Capabilities 에서 팀을 고르고 → Run
```

## 무엇이 달라지는가

| | 지금 PWA | 이 앱 |
|---|---|---|
| 앱을 나간 뒤 휴식 타이머 | 남은 시간은 맞지만 **울리지 않음** | 정확한 시각에 알림 |
| 화면이 꺼진 상태 | 울리지 않음 | 울림 |
| 앱을 완전히 종료 | 울리지 않음 | 울림 |
| 첫 화면 로딩 (Android) | 네트워크 필요 | APK 안의 파일로 즉시 |
| 기록·동기화·로그인 | 그대로 | **그대로** (같은 코드, 같은 Firebase) |

## 알아 두어야 할 것 둘

**1. 구글 로그인은 웹뷰 안에서 막힐 수 있습니다.**
구글은 정책상 앱 내장 웹뷰에서의 OAuth 를 차단합니다(`disallowed_useragent`).
아이디/비밀번호 로그인은 영향이 없습니다. 이 앱은 이 부분을 건드리지 않고
그대로 두었습니다 — 실기기에서 먼저 확인한 뒤, 막히면
`docs/DEVELOPMENT.md` 의 "구글 로그인" 절에 적어 둔 방법(시스템 브라우저
PKCE → `signInWithCredential`)으로 처리하면 됩니다.

**2. iOS 는 로컬 번들을 쓰지 않습니다.**
안드로이드는 APK 안의 파일을 `https://fitlog-4fe54.web.app` 이라는 진짜
도메인 이름으로 내놓을 수 있어서, 로컬 파일을 쓰면서도 저장소와 로그인이
웹과 완전히 같습니다. iOS 에는 그런 장치가 없습니다. 억지로 번들을 쓰면
출처가 달라져 기록이 통째로 안 보이고 로그인도 깨집니다. 그래서 iOS 는
원격 출처로 띄우고, 오프라인은 이미 있는 서비스워커가 담당합니다.
**타이머는 이 결정과 무관하게 양쪽 모두 완전히 네이티브입니다.**

자세한 이유는 `ios/FitLog/Config.swift` 맨 위 주석에 적어 두었습니다.

## 웹을 고쳤을 때

1. `fitlog-main` 에서 고칩니다.
2. `firebase deploy` (웹·iOS 에 반영)
3. `scripts\sync-web.ps1` 실행 후 Android 재빌드 (Android 에 반영)

`sw.js` 의 `CACHE` 버전과 `index.html` 의 `?v=` 번호를 같이 올리는 것을
잊지 마세요 — 지금은 `v69` 입니다.
