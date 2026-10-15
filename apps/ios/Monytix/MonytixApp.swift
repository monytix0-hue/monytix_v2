//
//  MonytixApp.swift
//  Monytix
//
//  Created by santosh malla on 10/10/26.
//

import SwiftUI
#if canImport(GoogleSignIn)
import GoogleSignIn
#endif

@main
struct MonytixApp: App {
    init() {
        PersonalFontRegistration.register()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .onOpenURL { url in
                    #if canImport(GoogleSignIn)
                    GIDSignIn.sharedInstance.handle(url)
                    #endif
                }
        }
    }
}

private struct RootView: View {
    @State private var showSplash = true

    var body: some View {
        ZStack {
            if showSplash {
                MonytixSplashView(onComplete: { showSplash = false })
                    .transition(.opacity)
            } else {
                SessionGate()
                    .businessTheme()
                    .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.45), value: showSplash)
    }
}
