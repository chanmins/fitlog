package com.fitlog.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Base64
import android.webkit.ConsoleMessage
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.webkit.ServiceWorkerClientCompat
import androidx.webkit.ServiceWorkerControllerCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import androidx.webkit.WebViewFeature
import java.io.File
import java.io.IOException

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var assetLoader: WebViewAssetLoader

    /** `<input type="file">` (기록 가져오기) 가 열어 둔 콜백. */
    private var filePickerCallback: ValueCallback<Array<Uri>>? = null

    private val filePicker = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val cb = filePickerCallback
        filePickerCallback = null
        /* 취소했을 때 null 을 돌려주지 않으면 웹뷰의 파일 입력이 영영 잠깁니다
           — 다음부터 파일 선택 버튼이 아무 반응도 하지 않습니다. */
        cb?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
    }

    private val notificationPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (!granted) {
            Toast.makeText(this, R.string.notification_denied, Toast.LENGTH_LONG).show()
        }
    }

    /* ── 수명주기 ──────────────────────────────────────────────────────── */

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        RestTimer.ensureChannels(this)

        webView = findViewById(R.id.webview)
        assetLoader = buildAssetLoader()
        configureWebView()
        installServiceWorkerBridge()

        /* 뒤로가기는 웹 히스토리 먼저. 더 갈 데가 없을 때만 앱이 닫힙니다. */
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })

        /* 네이티브에서 일어난 일을 웹 화면에 전합니다. 액티비티가 백그라운드에
           있을 때도 계속 받아야 하므로 onPause 에서 떼지 않습니다 — 알림에서
           휴식을 끄고 앱으로 돌아왔을 때 바가 사라져 있어야 합니다. */
        RestEvents.listener = { kind ->
            runOnUiThread {
                val fn = if (kind == RestEvents.CANCEL) "_cancelled" else "_finished"
                evalJs("window.FitLogNative && window.FitLogNative.$fn && window.FitLogNative.$fn();")
            }
        }

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState)
        } else {
            webView.loadUrl(Config.START_URL)
        }

        maybeAskNotificationPermission()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onResume() {
        super.onResume()
        RestEvents.foreground = true
        webView.onResume()
        /* 화면 밖에 있던 동안 흐른 시간은 웹이 visibilitychange 에서 스스로
           다시 계산합니다(끝나는 '시각' 을 들고 있으니까요). 네이티브가 끝내거나
           취소한 경우는 아래 RestEvents.listener 가 이미 전달했습니다 — 그
           리스너는 백그라운드에서도 살아 있습니다. 그래서 여기서는 할 일이
           없습니다. */
    }

    override fun onPause() {
        RestEvents.foreground = false
        webView.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        RestEvents.listener = null
        super.onDestroy()
    }

    /* ── 웹뷰 ──────────────────────────────────────────────────────────── */

    /**
     * 핵심 한 줄: 앱 안에 든 파일을 **진짜 도메인 이름으로** 내놓습니다.
     *
     * `setDomain(Config.APP_HOST)` 덕분에 웹뷰가 보는 출처는
     * https://fitlog-4fe54.web.app 입니다. 파일은 APK 안에서 오지만 브라우저
     * 입장에서는 그냥 그 사이트입니다. 그래서
     *   · 웹에서 쓰던 localStorage / IndexedDB 를 그대로 이어서 쓰고
     *   · 파이어베이스가 "등록된 도메인" 검사를 통과하고
     *   · 첫 화면이 네트워크 없이 즉시 뜹니다.
     *
     * 로컬에 없는 것(인증 핸들러 /__/, 파이어스토어 API, 운동 그림을 아직 안
     * 받았을 때)은 핸들러가 null 을 돌려주고, 그러면 웹뷰가 평소처럼
     * 네트워크로 갑니다. "로컬 번들 + 원격 폴백" 이 이 한 줄로 끝납니다.
     */
    private fun buildAssetLoader(): WebViewAssetLoader =
        WebViewAssetLoader.Builder()
            .setDomain(Config.APP_HOST)
            .addPathHandler("/", LocalWebHandler(applicationContext))
            .build()

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false   // 휴식 종료음
            cacheMode = WebSettings.LOAD_DEFAULT
            loadWithOverviewMode = false
            useWideViewPort = false
            builtInZoomControls = false
            displayZoomControls = false
            setSupportZoom(false)
            textZoom = 100                             // 시스템 글자 크기로 레이아웃이 깨지지 않게
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)

        webView.setBackgroundColor(ContextCompat.getColor(this, R.color.app_background))
        webView.overScrollMode = WebView.OVER_SCROLL_NEVER
        webView.addJavascriptInterface(WebBridge(this), "FitLogAndroid")
        webView.webViewClient = Client()
        webView.webChromeClient = Chrome()
        webView.setDownloadListener { url, _, contentDisposition, mimeType, _ ->
            handleDownload(url, contentDisposition, mimeType)
        }
    }

    /**
     * 서비스워커가 보내는 요청도 같은 로더를 통과시켜야 합니다. 이걸 빼면
     * 앱은 로컬 자산으로 잘 뜨는데, 서비스워커가 캐시를 채우려고 보내는
     * 요청만 네트워크로 나가서 비행기 모드에서 이상하게 실패합니다.
     */
    private fun installServiceWorkerBridge() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_BASIC_USAGE)) return
        try {
            ServiceWorkerControllerCompat.getInstance().setServiceWorkerClient(
                object : ServiceWorkerClientCompat() {
                    override fun shouldInterceptRequest(request: WebResourceRequest): WebResourceResponse? =
                        assetLoader.shouldInterceptRequest(request.url)
                }
            )
        } catch (_: Exception) {
        }
    }

    private inner class Client : WebViewClientCompat() {
        override fun shouldInterceptRequest(
            view: WebView,
            request: WebResourceRequest,
        ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url
            val host = url.host ?: return false
            /* 앱 자신과 로그인 왕복(구글/파이어베이스)은 웹뷰 안에서 끝나야
               합니다. 여기서 밖으로 던지면 로그인이 브라우저에서 끝나고
               앱은 계속 로그인 화면으로 남습니다. */
            if (host == Config.APP_HOST || host.endsWith("firebaseapp.com") ||
                host.endsWith("google.com") || host.endsWith("googleapis.com") ||
                host.endsWith("gstatic.com")
            ) return false
            /* 그 밖의 링크(개인정보처리방침, 외부 문서)는 시스템 브라우저로.
               앱 안에서 열면 뒤로가기가 꼬이고 앱스토어 심사에서도 지적받습니다. */
            return try {
                startActivity(Intent(Intent.ACTION_VIEW, url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                true
            } catch (_: ActivityNotFoundException) {
                false
            }
        }
    }

    private inner class Chrome : WebChromeClient() {
        override fun onShowFileChooser(
            view: WebView,
            callback: ValueCallback<Array<Uri>>,
            params: FileChooserParams,
        ): Boolean {
            filePickerCallback?.onReceiveValue(null)   // 이전 것이 남아 있으면 먼저 풀어 줍니다
            filePickerCallback = callback
            return try {
                filePicker.launch(params.createIntent())
                true
            } catch (_: ActivityNotFoundException) {
                filePickerCallback = null
                false
            }
        }

        /* 카메라·마이크는 이 앱이 쓰지 않습니다. 요청이 오면 조용히 거절해
           둡니다 — 웹뷰 기본값은 '무응답' 이라 페이지가 매달립니다. */
        override fun onPermissionRequest(request: PermissionRequest) = request.deny()

        override fun onConsoleMessage(msg: ConsoleMessage): Boolean {
            if (BuildConfig.DEBUG) {
                android.util.Log.d("FitLogWeb", "${msg.message()} @${msg.sourceId()}:${msg.lineNumber()}")
            }
            return true
        }
    }

    private fun evalJs(js: String) {
        try { webView.evaluateJavascript(js, null) } catch (_: Exception) {}
    }

    /* ── 알림 권한 ─────────────────────────────────────────────────────── */

    private fun maybeAskNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            == PackageManager.PERMISSION_GRANTED
        ) return
        /* 첫 실행에 바로 묻습니다. 휴식이 시작된 뒤에 물으면, 권한 대화상자가
           뜬 채로 첫 휴식이 통째로 지나갑니다. */
        requestNotificationPermission()
    }

    fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    /* ── 백업 내보내기 (blob: 다운로드) ────────────────────────────────── */

    private fun handleDownload(url: String, contentDisposition: String?, mimeType: String?) {
        val name = fileNameFrom(contentDisposition) ?: "fitlog-backup.json"
        val mime = mimeType?.ifBlank { null } ?: "application/json"
        if (!url.startsWith("blob:")) {
            try {
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            } catch (_: ActivityNotFoundException) {
            }
            return
        }
        /* 웹뷰는 blob: 을 스스로 저장하지 못합니다. 페이지 안에서 다시 읽어
           base64 로 넘겨받는 것이 유일한 방법입니다. */
        evalJs(
            """
            (function () {
              try {
                var x = new XMLHttpRequest();
                x.open('GET', ${jsString(url)}, true);
                x.responseType = 'blob';
                x.onload = function () {
                  var r = new FileReader();
                  r.onloadend = function () {
                    var s = String(r.result || '');
                    var b = s.substring(s.indexOf(',') + 1);
                    window.FitLogAndroid.saveFile(${jsString(name)}, ${jsString(mime)}, b);
                  };
                  r.readAsDataURL(x.response);
                };
                x.send();
              } catch (e) {}
            })();
            """.trimIndent()
        )
    }

    fun saveAndShare(name: String, mime: String, base64: String) {
        try {
            val dir = File(cacheDir, "exports").apply { mkdirs() }
            val file = File(dir, name.substringAfterLast('/'))
            file.writeBytes(Base64.decode(base64, Base64.DEFAULT))
            val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", file)
            val share = Intent(Intent.ACTION_SEND).apply {
                type = mime
                putExtra(Intent.EXTRA_STREAM, uri)
                putExtra(Intent.EXTRA_SUBJECT, name)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            startActivity(Intent.createChooser(share, getString(R.string.export_share_title)))
        } catch (_: Exception) {
            Toast.makeText(this, R.string.export_failed, Toast.LENGTH_LONG).show()
        }
    }

    private fun fileNameFrom(contentDisposition: String?): String? {
        val cd = contentDisposition ?: return null
        val m = Regex("""filename\*?=(?:UTF-8'')?"?([^";]+)"?""", RegexOption.IGNORE_CASE).find(cd)
        return m?.groupValues?.get(1)?.trim()?.takeIf { it.isNotEmpty() }
    }

    private fun jsString(s: String): String =
        "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "") + "\""
}

/**
 * assets/web/ 안의 파일을 웹 응답으로 바꿔 주는 핸들러.
 *
 * 없는 파일에는 null 을 돌려줍니다. 그게 "원격 폴백" 입니다 — 로더가 null 을
 * 보면 웹뷰가 평소대로 네트워크로 가져옵니다. 그래서 운동 그림 280개를 전부
 * APK 에 넣지 않아도 되고(넣으면 앱이 7MB 커집니다), 넣으면 넣은 만큼
 * 오프라인에서 더 잘 돕니다.
 */
private class LocalWebHandler(private val ctx: Context) : WebViewAssetLoader.PathHandler {

    override fun handle(path: String): WebResourceResponse? {
        val clean = path.trimStart('/').substringBefore('?').substringBefore('#')
        /* 인증 핸들러 같은 것은 서버만 만들 수 있습니다. 절대 가로채지 않습니다. */
        if (Config.NETWORK_ONLY_PREFIXES.any { "/$clean".startsWith(it) }) return null
        if (clean.contains("..")) return null

        val asset = "web/" + if (clean.isEmpty() || clean.endsWith("/")) "${clean}index.html" else clean
        return try {
            val stream = ctx.assets.open(asset)
            val mime = mimeOf(asset)
            WebResourceResponse(
                mime,
                if (mime.startsWith("text/") || mime.endsWith("javascript") || mime.endsWith("json") || mime.endsWith("xml")) "utf-8" else null,
                200,
                "OK",
                mapOf(
                    /* 로컬 파일이니 캐시할 이유가 없습니다. 캐시해 두면 앱을
                       업데이트했는데 옛날 화면이 남습니다. */
                    "Cache-Control" to "no-cache, no-store",
                ),
                stream,
            )
        } catch (_: IOException) {
            null   // ← 번들에 없음 = 네트워크로
        }
    }

    private fun mimeOf(path: String): String = when (path.substringAfterLast('.', "").lowercase()) {
        "html", "htm" -> "text/html"
        "js", "mjs" -> "text/javascript"
        "css" -> "text/css"
        "json", "webmanifest" -> "application/json"
        "svg" -> "image/svg+xml"
        "png" -> "image/png"
        "jpg", "jpeg" -> "image/jpeg"
        "webp" -> "image/webp"
        "ico" -> "image/x-icon"
        "woff2" -> "font/woff2"
        "woff" -> "font/woff"
        "txt" -> "text/plain"
        else -> "application/octet-stream"
    }
}
