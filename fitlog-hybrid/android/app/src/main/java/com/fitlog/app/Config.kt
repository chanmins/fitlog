package com.fitlog.app

/**
 * 앱 껍데기가 알아야 하는 값은 여기 세 줄이 전부입니다.
 *
 * APP_HOST 가 왜 "진짜 도메인" 이어야 하는지가 이 파일에서 제일 중요한
 * 이야기입니다. 웹뷰에 넣는 화면은 APK 안에 들어 있는 로컬 파일이지만,
 * 브라우저에게는 https://fitlog-4fe54.web.app/ 에서 온 것처럼 보이게 합니다
 * (MainActivity 의 WebViewAssetLoader). 그래야
 *
 *   · localStorage / IndexedDB 가 웹에서 쓰던 것과 같은 저장소를 가리키고
 *   · 파이어베이스 인증이 "등록된 도메인" 검사를 통과하고
 *   · /__/auth/handler 로 가는 로그인 왕복이 같은 출처 안에서 끝납니다
 *
 * file:// 이나 앱 전용 스킴으로 띄우면 이 셋이 전부 깨집니다. 로그인이 되는
 * 것처럼 보이다가 화면만 그대로인 증상이 거기서 나옵니다.
 */
object Config {
    /** 웹앱이 배포된 실제 호스트. 로컬 번들도 이 이름으로 서빙합니다. */
    const val APP_HOST = "fitlog-4fe54.web.app"

    const val APP_ORIGIN = "https://$APP_HOST"

    const val START_URL = "$APP_ORIGIN/"

    /**
     * 이 경로들은 절대 로컬 자산으로 가로채지 않습니다. 파이어베이스 인증
     * 핸들러는 서버가 만들어 주는 페이지라 APK 안에 있을 수가 없고, 여기서
     * 로컬 파일을 돌려주면 구글 로그인이 404 로 끝납니다.
     */
    val NETWORK_ONLY_PREFIXES = listOf("/__/")
}
