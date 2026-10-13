package com.monytix.app.splash

import android.app.Activity
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.view.WindowCompat
import com.monytix.app.R
import com.monytix.app.theme.LocalBusinessTheme
import kotlinx.coroutines.delay

private val NightSky = Color(0xFF0D1218)
private val Sage = Color(0xFF8ABC9E)
private val Amber = Color(0xFFC4956A)
private val Contrast = Color(0xFF111D2B)

@Composable
fun MonytixSplash(onFinished: () -> Unit) {
    val view = LocalView.current
    DisposableEffect(Unit) {
        val window = (view.context as Activity).window
        val controller = WindowCompat.getInsetsController(window, view)
        controller.isAppearanceLightStatusBars = false
        controller.isAppearanceLightNavigationBars = false
        onDispose { }
    }

    var phase by remember { mutableIntStateOf(0) }
    LaunchedEffect(Unit) {
        phase = 1
        delay(200)
        phase = 2
        delay(710)
        phase = 3
        delay(110)
        phase = 4
        delay(110)
        phase = 5
        delay(110)
        phase = 6
        delay(580)
        phase = 7
        delay(250)
        phase = 8
        delay(700)
        phase = 9
        delay(200)
        phase = 10
        delay(700)
        onFinished()
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(NightSky),
    ) {
        Box(
            Modifier
                .fillMaxSize()
                .alpha(if (phase >= 1) 1f else 0f)
                .background(Brush.radialGradient(listOf(Sage.copy(alpha = 0.15f), Color.Transparent))),
        )
        Box(
            Modifier
                .fillMaxSize()
                .alpha(if (phase >= 1) 1f else 0f)
                .background(Brush.radialGradient(listOf(Amber.copy(alpha = 0.09f), Color.Transparent))),
        )
        Column(
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.weight(1f))
            Mark(phase)
            DividerLine(visible = phase >= 7)
            Wordmark(visible = phase >= 8)
            Tagline(visible = phase >= 9)
            Spacer(Modifier.weight(1f))
        }
        Footer(
            visible = phase >= 10,
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = 48.dp),
        )
    }
}

@Composable
private fun Mark(phase: Int) {
    val ringAlpha by animateFloatAsState(if (phase >= 1) 0.7f else 0f, tween(450), label = "ring")
    val seedScale by animateFloatAsState(if (phase >= 2) 1f else 0.01f, tween(650), label = "seed")
    val seedAlpha by animateFloatAsState(if (phase >= 3) 0f else 1f, tween(250), label = "seedFade")
    Box(Modifier.size(164.dp), contentAlignment = Alignment.Center) {
        Box(
            Modifier
                .size(160.dp)
                .alpha(ringAlpha)
                .clip(CircleShape)
                .background(Contrast),
        )
        Box(
            Modifier
                .size(140.dp * seedScale)
                .alpha(seedAlpha)
                .clip(CircleShape)
                .background(Amber),
        )
        Box(Modifier.size(140.dp)) {
            Segment(R.drawable.ic_seg_yellow, phase >= 3)
            Segment(R.drawable.ic_seg_cyan, phase >= 4)
            Segment(R.drawable.ic_seg_orange, phase >= 5)
            Segment(R.drawable.ic_seg_navy, phase >= 6)
        }
    }
}

@Composable
private fun Segment(drawable: Int, visible: Boolean) {
    val alpha by animateFloatAsState(
        if (visible) 1f else 0f,
        spring(dampingRatio = 0.55f),
        label = "segAlpha",
    )
    val scale by animateFloatAsState(
        if (visible) 1f else 0.55f,
        spring(dampingRatio = 0.55f),
        label = "segScale",
    )
    Image(
        painter = painterResource(drawable),
        contentDescription = null,
        modifier = Modifier
            .fillMaxSize()
            .graphicsLayer {
                this.alpha = alpha
                scaleX = scale
                scaleY = scale
            },
    )
}

@Composable
private fun DividerLine(visible: Boolean) {
    val width by animateDpAsState(if (visible) 180.dp else 0.dp, tween(550), label = "divider")
    Box(
        Modifier
            .padding(top = 28.dp)
            .width(width)
            .height(1.dp)
            .background(
                Brush.horizontalGradient(
                    listOf(Color.Transparent, Amber.copy(alpha = 0.65f), Color.Transparent),
                ),
            ),
    )
}

@Composable
private fun Wordmark(visible: Boolean) {
    val alpha by animateFloatAsState(if (visible) 1f else 0f, spring(dampingRatio = 0.7f), label = "word")
    val offset by animateDpAsState(if (visible) 0.dp else 40.dp, spring(dampingRatio = 0.7f), label = "wordY")
    Image(
        painter = painterResource(R.drawable.monytix_wordmark),
        contentDescription = "Monytix",
        contentScale = ContentScale.Fit,
        modifier = Modifier
            .padding(top = 18.dp)
            .size(width = 260.dp, height = 48.dp)
            .offset(y = offset)
            .alpha(alpha),
    )
}

@Composable
private fun Tagline(visible: Boolean) {
    val theme = LocalBusinessTheme.current
    val alpha by animateFloatAsState(if (visible) 1f else 0f, tween(600), label = "tag")
    Text(
        text = "ADAPTIVE FINANCIAL INTELLIGENCE",
        color = Sage.copy(alpha = 0.85f),
        fontFamily = theme.fontFamily,
        fontWeight = FontWeight.SemiBold,
        fontSize = 11.sp,
        letterSpacing = 2.5.sp,
        modifier = Modifier
            .padding(top = 14.dp)
            .alpha(alpha),
    )
}

@Composable
private fun Footer(visible: Boolean, modifier: Modifier) {
    val theme = LocalBusinessTheme.current
    val alpha by animateFloatAsState(if (visible) 1f else 0f, tween(500), label = "foot")
    Text(
        text = "INDIA'S DECISION LAYER FOR MONEY",
        color = Amber.copy(alpha = 0.55f),
        fontFamily = theme.fontFamily,
        fontWeight = FontWeight.SemiBold,
        fontSize = 9.sp,
        letterSpacing = 2.8.sp,
        modifier = modifier.alpha(alpha),
    )
}
