package com.monytix.app.splash

import android.app.Activity
import android.provider.Settings
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowCompat
import com.monytix.app.R
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val NightSky = Color(0xFF0D1B2A)
private val Sage = Color(0xFF8ABC9E)
private val Amber = Color(0xFFC4956A)
private val EaseOutCubic = Easing { t ->
    val u = 1f - t
    1f - u * u * u
}
private val EaseInOutCubic = Easing { t ->
    if (t < 0.5f) {
        4f * t * t * t
    } else {
        val u = -2f * t + 2f
        1f - (u * u * u) / 2f
    }
}
private val SegmentOvershoot = CubicBezierEasing(0.34f, 1.56f, 0.64f, 1f)
private val CssEase = CubicBezierEasing(0.25f, 0.1f, 0.25f, 1f)

@Composable
fun MonytixSplash(onFinished: () -> Unit) {
    val view = LocalView.current
    DisposableEffect(Unit) {
        val window = (view.context as Activity).window
        val controller = WindowCompat.getInsetsController(window, view)
        val previousStatus = window.statusBarColor
        val previousNav = window.navigationBarColor
        window.statusBarColor = 0xFF0D1B2A.toInt()
        window.navigationBarColor = 0xFF0D1B2A.toInt()
        controller.isAppearanceLightStatusBars = false
        controller.isAppearanceLightNavigationBars = false
        onDispose {
            window.statusBarColor = previousStatus
            window.navigationBarColor = previousNav
        }
    }

    val reduceMotion = animatorScale() == 0f
    var track by remember { mutableFloatStateOf(0f) }
    var sweep by remember { mutableFloatStateOf(0f) }
    var loader by remember { mutableFloatStateOf(1f) }
    var markScale by remember { mutableFloatStateOf(if (reduceMotion) 1f else 0.85f) }
    var markAlpha by remember { mutableFloatStateOf(if (reduceMotion) 1f else 0f) }
    var yellow by remember { mutableFloatStateOf(if (reduceMotion) 1f else 0f) }
    var cyan by remember { mutableFloatStateOf(if (reduceMotion) 1f else 0f) }
    var orange by remember { mutableFloatStateOf(if (reduceMotion) 1f else 0f) }
    var navy by remember { mutableFloatStateOf(if (reduceMotion) 1f else 0f) }
    var wipe by remember { mutableFloatStateOf(if (reduceMotion) 1f else 0f) }
    var shimmer by remember { mutableFloatStateOf(0f) }

    LaunchedEffect(reduceMotion) {
        if (reduceMotion) {
            onFinished()
            return@LaunchedEffect
        }
        delay(150)
        animate(0f, 0.1f, animationSpec = tween(350, easing = EaseOutCubic)) { value, _ -> track = value }
        animate(0f, 1f, animationSpec = tween(900, easing = EaseInOutCubic)) { value, _ -> sweep = value }
        delay(60)
        animate(0f, 1f, animationSpec = tween(250, easing = EaseOutCubic)) { value, _ ->
            track = 0.1f * (1f - value)
            loader = 1f - value
        }
        track = 0f
        loader = 0f
        coroutineScope {
            launch {
                animate(0.85f, 1f, animationSpec = tween(400, easing = SegmentOvershoot)) { value, _ ->
                    markScale = value
                }
            }
            launch {
                animate(0f, 1f, animationSpec = tween(180, easing = CssEase)) { value, _ -> markAlpha = value }
            }
            launch { fadeSegment(0) { yellow = it } }
            launch { fadeSegment(60) { cyan = it } }
            launch { fadeSegment(120) { orange = it } }
            launch { fadeSegment(180) { navy = it } }
            delay(420)
        }
        animate(0f, 1f, animationSpec = tween(700, easing = EaseInOutCubic)) { value, _ -> wipe = value }
        delay(200)
        animate(0f, 1f, animationSpec = tween(700, easing = EaseInOutCubic)) { value, _ -> shimmer = value }
        shimmer = 0f
        delay(600)
        onFinished()
    }

    BoxWithConstraints(
        modifier = Modifier
            .fillMaxSize()
            .background(NightSky),
        contentAlignment = Alignment.Center,
    ) {
        val wordWidth = minOf(300.dp, maxWidth * 0.64f)
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(24.dp),
        ) {
            Box(Modifier.size(96.dp), contentAlignment = Alignment.Center) {
                LoaderRing(track = track, sweep = sweep, loader = loader)
                Box(
                    Modifier
                        .size(96.dp)
                        .graphicsLayer {
                            scaleX = markScale
                            scaleY = markScale
                            alpha = markAlpha
                        },
                ) {
                    Segment(R.drawable.ic_seg_yellow, yellow)
                    Segment(R.drawable.ic_seg_cyan, cyan)
                    Segment(R.drawable.ic_seg_orange, orange)
                    Segment(R.drawable.ic_seg_navy, navy)
                }
            }
            GoldWordmark(
                wipe = wipe,
                shimmer = shimmer,
                modifier = Modifier
                    .width(wordWidth)
                    .height(48.dp),
            )
        }
    }
}

@Composable
private fun LoaderRing(track: Float, sweep: Float, loader: Float) {
    Canvas(Modifier.fillMaxSize()) {
        val stroke = 8f / 96f * size.minDimension
        val radius = 35f / 96f * size.minDimension
        val topLeft = Offset(center.x - radius, center.y - radius)
        val arcSize = Size(radius * 2f, radius * 2f)
        val style = Stroke(width = stroke, cap = StrokeCap.Butt)
        if (track > 0f) {
            drawArc(Sage.copy(alpha = track), 0f, 360f, false, topLeft, arcSize, style = style)
        }
        if (loader > 0f && sweep > 0f) {
            drawArc(Amber.copy(alpha = loader), -90f, sweep * 360f, false, topLeft, arcSize, style = style)
        }
    }
}

@Composable
private fun Segment(drawable: Int, alpha: Float) {
    Image(
        painter = painterResource(drawable),
        contentDescription = null,
        modifier = Modifier
            .fillMaxSize()
            .graphicsLayer { this.alpha = alpha },
    )
}

@Composable
private fun GoldWordmark(wipe: Float, shimmer: Float, modifier: Modifier) {
    Image(
        painter = painterResource(R.drawable.ic_monytix_wordmark_gold),
        contentDescription = "Monytix",
        contentScale = ContentScale.Fit,
        modifier = modifier.drawWithContent {
            val revealed = size.width * wipe.coerceIn(0f, 1f)
            clipRect(right = revealed) {
                this@drawWithContent.drawContent()
                if (shimmer > 0f) {
                    val start = size.width * ((-80f + shimmer * 260f) / 100f)
                    val end = size.width * ((-20f + shimmer * 260f) / 100f)
                    drawRect(
                        brush = Brush.horizontalGradient(
                            0f to Color.Transparent,
                            0.45f to Color.Transparent,
                            0.5f to Color.White.copy(alpha = 0.45f),
                            0.55f to Color.Transparent,
                            1f to Color.Transparent,
                            startX = start,
                            endX = end,
                        ),
                        blendMode = BlendMode.SrcAtop,
                    )
                }
            }
        },
    )
}

private suspend fun fadeSegment(startDelay: Long, set: (Float) -> Unit) {
    delay(startDelay)
    animate(0f, 1f, animationSpec = tween(220, easing = CssEase)) { value, _ -> set(value) }
}

@Composable
private fun animatorScale(): Float {
    val context = LocalContext.current
    return Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f)
}
