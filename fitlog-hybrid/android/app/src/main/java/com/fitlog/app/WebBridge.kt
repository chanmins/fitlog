package com.fitlog.app

import android.webkit.JavascriptInterface

/**
 * 웹에서 `window.FitLogAndroid.*` 로 부르는 것들.
 *
 * 주의할 점 둘:
 *  1. 여기 메서드는 웹뷰의 JavaBridge 스레드에서 불립니다. UI(웹뷰, 토스트,
 *     권한 요청)를 건드리는 일은 반드시 액티비티 쪽으로 넘겨야 합니다.
 *  2. 인자는 문자열 하나로 받습니다. 자바스크립트의 숫자를 int 로 받으면
 *     endsAt(epoch 밀리초, 1.7조)이 조용히 잘립니다. JSON 문자열로 주고받는
 *     이유가 이것입니다.
 */
class WebBridge(private val activity: MainActivity) {

    @JavascriptInterface
    fun platform(): String = "android"

    @JavascriptInterface
    fun startRest(json: String) {
        val rest = RestTimer.Rest.from(json) ?: return
        activity.runOnUiThread { RestTimer.start(activity, rest) }
    }

    /** ±15초. 끝나는 시각만 바뀌므로 start 와 하는 일이 같습니다. */
    @JavascriptInterface
    fun updateRest(json: String) = startRest(json)

    @JavascriptInterface
    fun stopRest(json: String?) {
        activity.runOnUiThread { RestTimer.stop(activity) }
    }

    /**
     * 앱을 다시 열었을 때 웹이 물어봅니다. 이 값이 있으면 웹은 자기
     * localStorage 대신 이걸 씁니다 — 앱이 죽어 있는 동안에도 계속 돌던 쪽이
     * 여기니까요. 동기 호출이라 웹 첫 렌더 전에 답을 줄 수 있습니다.
     */
    @JavascriptInterface
    fun pendingRest(): String = RestTimer.current(activity)?.toJson() ?: ""

    @JavascriptInterface
    fun requestNotificationPermission(json: String?) {
        activity.runOnUiThread { activity.requestNotificationPermission() }
    }

    /**
     * 백업 내보내기. 웹은 blob: URL 로 `<a download>` 를 누르는데, 안드로이드
     * 웹뷰는 blob: 다운로드를 아예 처리하지 못합니다(DownloadListener 도 안
     * 불립니다). 그래서 MainActivity 가 blob 을 base64 로 읽어 이리로 넘기고,
     * 여기서 파일로 떨어뜨린 뒤 공유 시트를 엽니다. 저장소 권한이 필요 없는
     * 방법입니다.
     */
    @JavascriptInterface
    fun saveFile(name: String, mime: String, base64: String) {
        activity.runOnUiThread { activity.saveAndShare(name, mime, base64) }
    }
}
