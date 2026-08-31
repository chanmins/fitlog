import UIKit
import WebKit
import UserNotifications

/// 앱 화면 전부. 웹뷰 하나와, 첫 실행에 네트워크가 없을 때만 나오는 재시도
/// 화면 하나로 되어 있습니다.
final class WebViewController: UIViewController {

    private var webView: WKWebView!
    /* `webView.configuration` 은 **복사본**을 돌려줍니다. 거기에 붙인
       유저스크립트가 반영되지 않는 사고가 유명해서, 만들 때 쓴 컨트롤러를
       직접 들고 있습니다. */
    private let userContent = WKUserContentController()
    private lazy var offlineView = makeOfflineView()
    private let bridgeName = "fitlog"

    /// 웹이 아직 안 떠 있을 때 도착한 소식을 들고 있다가, 뜨면 넘깁니다.
    /// (알림을 눌러 앱이 처음 켜지는 경우가 정확히 이 상황입니다.)
    private var pendingWebEvents: [String] = []
    private var webReady = false

    // MARK: - 수명주기

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0x09/255, green: 0x09/255, blue: 0x0d/255, alpha: 1)

        buildWebView()
        loadApp()

        /* 알림 권한은 첫 실행에 바로 묻습니다. 휴식이 시작된 다음에 물으면
           권한 대화상자가 뜬 채로 첫 휴식이 통째로 지나갑니다. */
        RestTimerManager.shared.requestAuthorization()

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(appWillEnterForeground),
            name: UIApplication.willEnterForegroundNotification,
            object: nil
        )
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }
    override var prefersHomeIndicatorAutoHidden: Bool { false }

    // MARK: - 웹뷰

    private func buildWebView() {
        userContent.add(BridgeProxy(self), name: bridgeName)

        let config = WKWebViewConfiguration()
        config.userContentController = userContent
        config.allowsInlineMediaPlayback = true
        /* 휴식 종료음은 사용자가 버튼을 누른 결과지만, 소리가 나는 시점은
           그로부터 90초 뒤입니다. 제스처 요구를 켜 두면 그 소리가 막힙니다. */
        config.mediaTypesRequiringUserActionForPlayback = []
        config.websiteDataStore = .default()

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.isOpaque = false
        webView.backgroundColor = view.backgroundColor
        webView.scrollView.backgroundColor = view.backgroundColor
        /* 웹앱이 viewport-fit=cover + safe-area 로 자기 여백을 직접 잡습니다.
           여기서 인셋을 또 주면 하단이 두 번 밀립니다. */
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.bounces = false

        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
    }

    /// 페이지 스크립트보다 **먼저** 돌면서, 네이티브가 들고 있는 휴식을
    /// `window.__fitlogNativeRest` 에 꽂아 둡니다. iOS 는 웹에 동기적으로
    /// 값을 돌려줄 방법이 없어서(메시지는 단방향입니다) 이 방식이 필요합니다.
    /// 웹의 native-bridge.js 가 바로 이 변수를 읽습니다.
    private func refreshInjectedState() {
        userContent.removeAllUserScripts()

        let json: String
        if let rest = RestTimerManager.shared.current,
           let data = try? JSONSerialization.data(withJSONObject: rest.dictionary),
           let text = String(data: data, encoding: .utf8) {
            json = text
        } else {
            json = "null"
        }

        userContent.addUserScript(WKUserScript(
            source: "window.__fitlogNativeRest = \(json);",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
    }

    private func loadApp() {
        refreshInjectedState()
        webReady = false
        var request = URLRequest(url: Config.startURL)
        /* 서비스워커 캐시를 우선 쓰되, 있으면 새 버전도 받아 오게 둡니다. */
        request.cachePolicy = .useProtocolCachePolicy
        webView.load(request)
    }

    @objc private func appWillEnterForeground() {
        /* 화면 밖에 있던 동안 흐른 시간은 웹이 스스로 다시 계산합니다.
           여기서는 이미 지난 휴식의 흔적만 정리합니다. */
        if RestTimerManager.shared.current == nil {
            RestTimerManager.shared.markFinished()
        }
    }

    // MARK: - 네이티브 → 웹

    func notifyWeb(_ kind: String) {
        guard webReady else {
            pendingWebEvents.append(kind)
            return
        }
        let fn = (kind == "cancel") ? "_cancelled" : "_finished"
        let js = "window.FitLogNative && window.FitLogNative.\(fn) && window.FitLogNative.\(fn)();"
        DispatchQueue.main.async { [weak self] in
            self?.webView.evaluateJavaScript(js, completionHandler: nil)
        }
    }

    private func flushPendingWebEvents() {
        let events = pendingWebEvents
        pendingWebEvents.removeAll()
        events.forEach(notifyWeb)
    }

    // MARK: - 웹 → 네이티브

    fileprivate func handle(message body: [String: Any]) {
        guard let action = body["action"] as? String else { return }
        switch action {
        case "startRest", "updateRest":
            guard let rest = RestTimerManager.Rest(message: body) else { return }
            RestTimerManager.shared.start(rest)

        case "stopRest":
            RestTimerManager.shared.stop()

        case "requestNotificationPermission":
            RestTimerManager.shared.requestAuthorization()

        case "saveFile":
            let name = (body["name"] as? String) ?? "fitlog-backup.json"
            let base64 = (body["data"] as? String) ?? ""
            share(fileNamed: name, base64: base64)

        default:
            break
        }
    }

    // MARK: - 백업 내보내기

    /// 웹은 `<a download href="blob:...">` 로 파일을 내려받습니다. WKWebView 는
    /// blob: 을 스스로 저장하지 못하므로, 페이지 안에서 다시 읽어 base64 로
    /// 넘겨받은 뒤 공유 시트를 엽니다.
    private func downloadBlob(_ url: URL) {
        let js = """
        (function () {
          try {
            var x = new XMLHttpRequest();
            x.open('GET', '\(url.absoluteString)', true);
            x.responseType = 'blob';
            x.onload = function () {
              var r = new FileReader();
              r.onloadend = function () {
                var s = String(r.result || '');
                window.webkit.messageHandlers.\(bridgeName).postMessage({
                  action: 'saveFile',
                  name: 'fitlog-backup.json',
                  data: s.substring(s.indexOf(',') + 1)
                });
              };
              r.readAsDataURL(x.response);
            };
            x.send();
          } catch (e) {}
        })();
        """
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    private func share(fileNamed name: String, base64: String) {
        guard let data = Data(base64Encoded: base64) else { return }
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent((name as NSString).lastPathComponent)
        do {
            try data.write(to: url, options: .atomic)
        } catch {
            return
        }
        let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        sheet.popoverPresentationController?.sourceView = view
        sheet.popoverPresentationController?.sourceRect = CGRect(
            x: view.bounds.midX, y: view.bounds.midY, width: 0, height: 0
        )
        present(sheet, animated: true)
    }

    // MARK: - 오프라인 화면

    private func makeOfflineView() -> UIView {
        let container = UIView()
        container.backgroundColor = view.backgroundColor
        container.translatesAutoresizingMaskIntoConstraints = false
        container.isHidden = true

        let title = UILabel()
        title.text = "연결할 수 없습니다"
        title.font = .systemFont(ofSize: 20, weight: .semibold)
        title.textColor = .white
        title.textAlignment = .center

        let detail = UILabel()
        detail.text = "인터넷에 연결한 뒤 다시 시도해 주세요.\n한 번 열어 둔 뒤에는 오프라인에서도 실행됩니다."
        detail.font = .systemFont(ofSize: 14)
        detail.textColor = UIColor(white: 1, alpha: 0.6)
        detail.numberOfLines = 0
        detail.textAlignment = .center

        let button = UIButton(type: .system)
        button.setTitle("다시 시도", for: .normal)
        button.setTitleColor(UIColor(red: 0xC8/255, green: 0xF5/255, blue: 0x42/255, alpha: 1), for: .normal)
        button.titleLabel?.font = .systemFont(ofSize: 16, weight: .semibold)
        button.addTarget(self, action: #selector(retryLoad), for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [title, detail, button])
        stack.axis = .vertical
        stack.spacing = 12
        stack.alignment = .center
        stack.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(stack)

        view.addSubview(container)
        NSLayoutConstraint.activate([
            container.topAnchor.constraint(equalTo: view.topAnchor),
            container.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            container.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            container.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            stack.centerXAnchor.constraint(equalTo: container.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: container.centerYAnchor),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: container.leadingAnchor, constant: 32),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: container.trailingAnchor, constant: -32),
        ])
        return container
    }

    @objc private func retryLoad() {
        offlineView.isHidden = true
        loadApp()
    }
}

// MARK: - 브릿지 프록시

/// `WKUserContentController` 는 핸들러를 강하게 붙듭니다. 뷰컨트롤러를 직접
/// 등록하면 서로를 붙들어 영영 해제되지 않습니다(고전적인 WKWebView 누수).
/// 약한 참조를 한 겹 두어 끊습니다.
private final class BridgeProxy: NSObject, WKScriptMessageHandler {
    private weak var target: WebViewController?

    init(_ target: WebViewController) {
        self.target = target
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }
        target?.handle(message: body)
    }
}

// MARK: - 내비게이션

extension WebViewController: WKNavigationDelegate {

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }

        if url.scheme == "blob" {
            downloadBlob(url)
            decisionHandler(.cancel)
            return
        }

        /* 앱 자신과 로그인 왕복은 웹뷰 안에서. 그 밖의 링크(개인정보처리방침
           같은 외부 문서)는 사파리로 넘깁니다 — 앱 안에서 열면 돌아올 길이
           없고 심사에서도 지적받습니다. */
        if navigationAction.navigationType == .linkActivated,
           !Config.opensInApp(url),
           url.scheme?.hasPrefix("http") == true {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
            return
        }

        if let scheme = url.scheme, !["http", "https", "about", "data"].contains(scheme) {
            if UIApplication.shared.canOpenURL(url) { UIApplication.shared.open(url) }
            decisionHandler(.cancel)
            return
        }

        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        offlineView.isHidden = true
        webReady = true
        flushPendingWebEvents()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        showOfflineIfBlank()
    }

    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        showOfflineIfBlank()
    }

    /// 웹뷰 렌더러가 메모리 압박으로 죽는 일이 드물게 있습니다. 그냥 두면
    /// 흰 화면이 남습니다.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        loadApp()
    }

    private func showOfflineIfBlank() {
        /* 이미 화면이 떠 있는데 나중 요청 하나가 실패한 거라면(그림 한 장 등)
           오프라인 화면을 덮지 않습니다. */
        guard !webReady else { return }
        offlineView.isHidden = false
        view.bringSubviewToFront(offlineView)
    }
}

// MARK: - 새 창 / 팝업

extension WebViewController: WKUIDelegate {
    /// 파이어베이스가 팝업으로 로그인을 시도할 때, target=_blank 는 새
    /// WKWebView 를 요구합니다. 새 창을 만들지 않고 같은 웹뷰에서 열어 주면
    /// 로그인 왕복이 그대로 이어집니다.
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if navigationAction.targetFrame == nil, let url = navigationAction.request.url {
            if Config.opensInApp(url) {
                webView.load(navigationAction.request)
            } else {
                UIApplication.shared.open(url)
            }
        }
        return nil
    }
}
