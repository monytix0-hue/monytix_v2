//
//  MonytixApp.swift
//  Monytix
//
//  Created by santosh malla on 10/10/26.
//

import SwiftUI

@main
struct MonytixApp: App {
    init() {
        PersonalFontRegistration.register()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
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
