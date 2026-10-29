# Monytix Splash Screen — Integration Guide

Motion source of truth: HTML O-mark animation (contrast ring → amber seed bloom →
segment pop-in). Native splash keeps Night Sky, divider, wordmark, tagline, and footer.

## Files included

```
monytix_splash/
├── android/
│   ├── MonytixSplashActivity.kt          ← Main Kotlin splash activity
│   └── res/
│       ├── drawable/
│       │   ├── ic_monytix_omark.xml      ← O-mark vector (all 4 segments)
│       │   ├── ic_seg_yellow.xml         ← Individual segment (yellow)
│       │   ├── ic_seg_cyan.xml           ← Individual segment (cyan)
│       │   ├── ic_seg_orange.xml         ← Individual segment (orange)
│       │   ├── ic_seg_navy.xml           ← Individual segment (navy)
│       │   ├── ic_seed_dot.xml           ← Amber seed (full O bloom)
│       │   ├── ic_contrast_ring.xml      ← Contrast disc behind O-mark
│       │   ├── splash_background.xml     ← Night Sky + ambient glows
│       │   ├── splash_background_legacy.xml  ← Pre-API31 windowBackground
│       │   └── divider_gold_gradient.xml ← Amber divider line
│       ├── layout/
│       │   └── activity_splash.xml       ← Splash layout (all API levels)
│       └── values/
│           ├── colors.xml                ← Full brand palette
│           └── themes.xml                ← Splash + main app themes
└── ios/
    └── MonytixSplash/
        ├── MonytixSplashViewController.swift  ← UIKit (UIViewController)
        ├── MonytixSplashView.swift            ← SwiftUI view
        └── LaunchScreen.storyboard            ← Static iOS launch screen

```

---

## Android integration

### 1. Dependencies (app/build.gradle)
```groovy
dependencies {
    implementation "androidx.core:core-splashscreen:1.0.1"
    implementation "com.google.android.material:material:1.11.0"
    implementation "androidx.constraintlayout:constraintlayout:2.1.4"
}
```

### 2. AndroidManifest.xml
```xml
<activity
    android:name=".MonytixSplashActivity"
    android:exported="true"
    android:theme="@style/Theme.Monytix.Splash">
    <intent-filter>
        <action android:name="android.intent.action.MAIN" />
        <category android:name="android.intent.category.LAUNCHER" />
    </intent-filter>
</activity>
```

### 3. How it works
- **All API levels:** Inflate `activity_splash.xml` and run the branded
  `ObjectAnimator` reveal (contrast ring → seed bloom → segments → divider →
  wordmark → tagline → footer).
- **Android 12+ (API 31+):** `installSplashScreen()` provides a static first frame
  (O-mark on Night Sky). `setOnExitAnimationListener` removes it without a flash,
  then the custom reveal plays. Do **not** skip `playReveal()` on API 31+.

### 4. Add the wordmark
Export your Canva wordmark (DAGydiWD3RM) as an SVG, save as
`res/drawable/ic_monytix_wordmark.xml`. Or use a PNG at `res/drawable-xxhdpi/`.

---

## iOS integration

### Option A — SwiftUI (recommended)

```swift
// MonytixApp.swift
@main
struct MonytixApp: App {
    @State private var showSplash = true

    var body: some Scene {
        WindowGroup {
            ZStack {
                if showSplash {
                    MonytixSplashView(onComplete: { showSplash = false })
                        .transition(.opacity)
                } else {
                    ContentView()
                        .transition(.opacity)
                }
            }
            .animation(.easeInOut(duration: 0.45), value: showSplash)
        }
    }
}
```

### Option B — UIKit (SceneDelegate)

```swift
// SceneDelegate.swift
func scene(_ scene: UIScene, willConnectTo session: UISceneSession,
           options: UIScene.ConnectionOptions) {
    guard let windowScene = scene as? UIWindowScene else { return }
    let window = UIWindow(windowScene: windowScene)
    window.rootViewController = MonytixSplashViewController()
    window.makeKeyAndVisible()
    self.window = window
}
```

### Assets required (add to Assets.xcassets)
- `ic_monytix_omark` — export the O-mark SVG from Canva (DAHC3oxOChM)
- `ic_monytix_wordmark` — export the wordmark SVG from Canva (DAGydiWD3RM)

### LaunchScreen.storyboard
Set in **Target → General → Launch Screen File → LaunchScreen**.
This shows while the app loads (~300ms). Then `MonytixSplashView` takes over
and plays the full animated reveal.

---

## Brand colour reference

| Token            | Hex       | Usage                          |
|------------------|-----------|--------------------------------|
| Night Sky        | `#0D1218` | Splash background (always dark)|
| Morning Mist     | `#F0EDE6` | Light mode (not used on splash)|
| Contrast ring    | `#111D2B` | Disc behind O-mark             |
| Seed (amber)     | `#C4956A` | Full-O bloom before segments   |
| O-mark Yellow    | `#F9C515` | Top-left segment               |
| O-mark Cyan      | `#55C2EF` | Top-right segment              |
| O-mark Orange    | `#F47521` | Right segment (largest)        |
| O-mark Navy      | `#313A96` | Bottom segment                 |
| Deep Sage        | `#2C4A3E` | Primary CTA                    |
| Sage Green       | `#8ABC9E` | Positive states, tagline       |
| Warm Amber       | `#C4956A` | Caution, divider, category     |
| Gold Light       | `#FFFFD6` | Wordmark gradient start        |
| Gold Dark        | `#7A5010` | Wordmark gradient end          |

---

## Animation timing

| Phase              | Start  | Duration |
|--------------------|--------|----------|
| Contrast ring      | 0.00s  | 0.45s    |
| Seed bloom (full O)| 0.20s  | 0.65s    |
| Seed fade          | 0.85s  | 0.25s    |
| Yellow segment     | 0.85s  | 0.40s    |
| Cyan segment       | 0.96s  | 0.40s    |
| Orange segment     | 1.07s  | 0.40s    |
| Navy segment       | 1.18s  | 0.40s    |
| Divider expand     | 1.76s  | 0.55s    |
| Wordmark up        | 2.01s  | 0.65s    |
| Tagline fade       | 2.71s  | 0.60s    |
| Category fade      | 2.91s  | 0.50s    |
| Navigate away      | ~3.60s | —        |

Segment motion: scale **0.55 → 1.0** with back/overshoot ease, **110ms** stagger.
