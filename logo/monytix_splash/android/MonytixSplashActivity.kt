package com.monytix.theme.splash

import android.animation.AnimatorSet
import android.animation.ObjectAnimator
import android.annotation.SuppressLint
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.animation.OvershootInterpolator
import android.view.animation.PathInterpolator
import androidx.activity.ComponentActivity
import androidx.activity.enableEdgeToEdge
import androidx.core.animation.doOnEnd
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.WindowCompat
import com.example.monytix.MainActivity
import com.example.monytix.R
import com.example.monytix.databinding.ActivitySplashBinding

/**
 * MonytixSplashActivity — HTML O-mark motion on all API levels.
 *
 * API 31+ : installSplashScreen() as static first frame, then custom reveal.
 * API < 31 : Inflates layout and runs the same ObjectAnimator sequence.
 *
 * Timing (HTML O-mark + brand chrome):
 *   0.00s  Contrast ring fade (0.45s)
 *   0.20s  Amber seed bloom to full O (easeInOut, 650ms)
 *   0.85s  Seed fade (250ms) + yellow segment (overshoot, 400ms)
 *   0.96s  Cyan segment
 *   1.07s  Orange segment
 *   1.18s  Navy segment
 *   1.76s  Divider expand
 *   2.01s  Wordmark slide
 *   2.71s  Tagline fade
 *   2.91s  Category fade
 *   ~3.6s  → Launch main
 */
@SuppressLint("CustomSplashScreen")
class MonytixSplashActivity : ComponentActivity() {

    private var binding: ActivitySplashBinding? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        // Keep system splash as static first frame; remove without flash once content is ready
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val splash = installSplashScreen()
            splash.setKeepOnScreenCondition { false }
            splash.setOnExitAnimationListener { provider ->
                provider.remove()
            }
        }

        enableEdgeToEdge()
        super.onCreate(savedInstanceState)

        binding = ActivitySplashBinding.inflate(layoutInflater)
        setContentView(binding?.root)

        window?.let {
            WindowCompat.setDecorFitsSystemWindows(it, false)
            it.statusBarColor = getColor(R.color.mx_night_sky)
            it.navigationBarColor = getColor(R.color.mx_night_sky)
        }

        binding?.let { b ->
            b.contrastRing?.apply { alpha = 0f }
            b.seedDot.apply {
                alpha = 1f; scaleX = 0.01f; scaleY = 0.01f
            }
            b.segYellow?.apply { alpha = 0f; scaleX = 0.55f; scaleY = 0.55f }
            b.segCyan?.apply   { alpha = 0f; scaleX = 0.55f; scaleY = 0.55f }
            b.segOrange?.apply { alpha = 0f; scaleX = 0.55f; scaleY = 0.55f }
            b.segNavy?.apply   { alpha = 0f; scaleX = 0.55f; scaleY = 0.55f }
            b.divider?.apply { alpha = 0f; scaleX = 0f }
            b.wordmark?.apply { alpha = 0f; translationY = 50f }
            b.tagline?.alpha = 0f
            b.category?.alpha = 0f

            playReveal(b)
        }
    }

    private fun playReveal(b: ActivitySplashBinding) {
        val overshoot = OvershootInterpolator(1.70158f)
        val easeInOut = PathInterpolator(0.42f, 0f, 0.58f, 1f)
        val spring = PathInterpolator(0.34f, 0.56f, 0.2f, 1f)

        fun segAnim(view: View, delay: Long) = AnimatorSet().apply {
            playTogether(
                ObjectAnimator.ofFloat(view, View.ALPHA, 0f, 1f).apply { duration = 400 },
                ObjectAnimator.ofFloat(view, View.SCALE_X, 0.55f, 1f).apply {
                    duration = 400; interpolator = overshoot
                },
                ObjectAnimator.ofFloat(view, View.SCALE_Y, 0.55f, 1f).apply {
                    duration = 400; interpolator = overshoot
                }
            )
            startDelay = delay
        }

        // Phase 0 — contrast ring
        val ringAnim = ObjectAnimator.ofFloat(b.contrastRing, View.ALPHA, 0f, 0.7f).apply {
            duration = 450
            startDelay = 0
        }

        // Phase 1 — amber seed bloom to full O (starts ~200ms)
        val seedBloom = AnimatorSet().apply {
            playTogether(
                ObjectAnimator.ofFloat(b.seedDot, View.SCALE_X, 0.01f, 1f).apply {
                    duration = 650; interpolator = easeInOut
                },
                ObjectAnimator.ofFloat(b.seedDot, View.SCALE_Y, 0.01f, 1f).apply {
                    duration = 650; interpolator = easeInOut
                }
            )
            startDelay = 200
        }

        // Phase 1b — seed fade overlapping first segment (~850ms)
        val seedFade = ObjectAnimator.ofFloat(b.seedDot, View.ALPHA, 1f, 0f).apply {
            duration = 250
            startDelay = 850
        }

        // Phase 2 — 4 segments staggered 110ms (start 850ms)
        val segSet = AnimatorSet().apply {
            playTogether(
                segAnim(b.segYellow, 850),
                segAnim(b.segCyan,   960),
                segAnim(b.segOrange, 1070),
                segAnim(b.segNavy,   1180)
            )
        }

        // Phase 3 — divider expand (~1760ms)
        val dividerAnim = AnimatorSet().apply {
            playTogether(
                ObjectAnimator.ofFloat(b.divider, View.ALPHA, 0f, 1f).apply { duration = 400 },
                ObjectAnimator.ofFloat(b.divider, "scaleX", 0f, 1f).apply {
                    duration = 550; interpolator = PathInterpolator(0.42f, 0f, 0.58f, 1f)
                }
            )
            startDelay = 1760
        }

        // Phase 4 — wordmark (~2010ms)
        val wordmarkAnim = AnimatorSet().apply {
            playTogether(
                ObjectAnimator.ofFloat(b.wordmark, View.ALPHA, 0f, 1f).apply { duration = 650 },
                ObjectAnimator.ofFloat(b.wordmark, View.TRANSLATION_Y, 50f, 0f).apply {
                    duration = 650; interpolator = spring
                }
            )
            startDelay = 2010
        }

        // Phase 5 — tagline + category
        val taglineAnim = ObjectAnimator.ofFloat(b.tagline, View.ALPHA, 0f, 1f).apply {
            duration = 600; startDelay = 2710
        }
        val categoryAnim = ObjectAnimator.ofFloat(b.category, View.ALPHA, 0f, 1f).apply {
            duration = 500; startDelay = 2910
        }

        AnimatorSet().apply {
            playTogether(
                ringAnim, seedBloom, seedFade, segSet,
                dividerAnim, wordmarkAnim, taglineAnim, categoryAnim
            )
            doOnEnd { navigateToMain(0) }
            start()
        }
    }

    private fun navigateToMain(delay: Long) {
        val root = binding?.root
        if (root != null) {
            root.postDelayed({
                startActivity(Intent(this, MainActivity::class.java))
                overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out)
                finish()
            }, delay)
        }
    }

    override fun onDestroy() {
        binding = null
        super.onDestroy()
    }
}
