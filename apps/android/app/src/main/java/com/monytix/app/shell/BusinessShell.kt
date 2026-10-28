package com.monytix.app.shell

import android.app.Activity
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import kotlinx.coroutines.launch
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.view.WindowCompat
import com.monytix.app.R
import com.monytix.app.add.AddButton
import com.monytix.app.add.AddSheets
import com.monytix.app.add.AddStep
import com.monytix.app.auth.MonytixApi
import com.monytix.app.decisions.DecisionFlow
import com.monytix.app.decisions.DecisionHome
import com.monytix.app.decisions.DecisionPage
import com.monytix.app.live.LiveDetail
import com.monytix.app.mile.MileHome
import com.monytix.app.mile.MileSheets
import com.monytix.app.mile.MileStep
import com.monytix.app.live.LiveHome
import com.monytix.app.live.LivePage
import com.monytix.app.missions.MissionCreate
import com.monytix.app.missions.MissionHome
import com.monytix.app.missions.MissionPage
import com.monytix.app.missions.MissionSheets
import com.monytix.app.missions.MissionStep
import com.monytix.app.theme.LocalPersonalTheme
import com.monytix.app.theme.PersonalSpace
import com.monytix.app.theme.PersonalTheme
import java.util.Calendar

private enum class Destination(val label: String, val glyph: Glyph) {
    Live("Live", Glyph.Pulse),
    Decisions("Decisions", Glyph.Decisions),
    Missions("Missions", Glyph.Missions),
    Mile("M.I.L.E.", Glyph.Pulse),
}

private enum class Glyph { Pulse, Decisions, Missions }

@Composable
fun BusinessShell(
    api: MonytixApi,
    token: suspend (Boolean) -> String?,
    store: UiSessionStore,
    onSignOut: () -> Unit,
) {
    PersonalTheme {
        val theme = LocalPersonalTheme.current
        val scope = rememberCoroutineScope()
        var destination by rememberSaveable { mutableStateOf(Destination.Live) }
        var page by rememberSaveable { mutableStateOf(LivePage.Home) }
        var missionPage by rememberSaveable { mutableStateOf(MissionPage.Home) }
        var missionStack by remember { mutableStateOf(listOf<MissionStep>()) }
        var decisionPage by remember { mutableStateOf(DecisionPage.Home) }
        var decisionId by remember { mutableStateOf("") }
        var mileStack by remember { mutableStateOf(listOf<MileStep>()) }
        var mileOutcomeId by remember { mutableStateOf("") }
        var mileEventId by remember { mutableStateOf("") }
        var addStep by remember { mutableStateOf<AddStep?>(null) }
        // Settings is not a tab: it is a full surface reached from the wordmark menu,
        // so it lives beside `destination` rather than inside it.
        var settingsOpen by rememberSaveable { mutableStateOf(false) }
        SystemBarContrast(dark = theme.isDark)
        val detail = destination == Destination.Live && page != LivePage.Home
        val creating = destination == Destination.Missions && missionPage == MissionPage.Create
        val deciding = destination == Destination.Decisions && decisionPage != DecisionPage.Home
        var missionId by remember { mutableStateOf("") }
        fun resetMissions() {
            missionPage = MissionPage.Home
            missionStack = emptyList()
            missionId = ""
        }
        fun resetDecisions() {
            decisionPage = DecisionPage.Home
            decisionId = ""
        }
        fun resetMile() {
            mileStack = emptyList()
            mileOutcomeId = ""
            mileEventId = ""
        }
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(theme.palette.canvas),
        ) {
            if (detail) {
                Column(Modifier.fillMaxSize().statusBarsPadding()) {
                    LiveDetail(
                        page = page,
                        store = store,
                        api = api,
                        token = token,
                        onBack = { page = LivePage.Home },
                        onAskMoly = { page = LivePage.Moly },
                    )
                }
            } else if (creating) {
                Column(Modifier.fillMaxSize().statusBarsPadding()) {
                    MissionCreate(
                        onBack = { missionPage = MissionPage.Home },
                        onDirection = { missionStack = listOf(MissionStep.Options(it)) },
                        onSomethingElse = { missionStack = listOf(MissionStep.SomethingElse) },
                    )
                }
            } else if (settingsOpen) {
                Column(Modifier.fillMaxSize().statusBarsPadding()) {
                    MoneySettings(
                        api = api,
                        token = token,
                        store = store,
                        onBack = { settingsOpen = false },
                    )
                }
            } else {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .statusBarsPadding(),
                ) {
                    LiveHeader(
                        onSignOut = onSignOut,
                        onSettings = {
                            settingsOpen = true
                            page = LivePage.Home
                            resetMissions()
                            resetDecisions()
                            resetMile()
                        },
                        onMoly = {
                            destination = Destination.Live
                            page = LivePage.Moly
                            resetMissions()
                            resetDecisions()
                            resetMile()
                        },
                    )
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxWidth(),
                        contentAlignment = Alignment.Center,
                    ) {
                        when (destination) {
                            Destination.Live -> LiveHome(
                                store = store,
                                onOpen = { page = it },
                                onViewMissions = {
                                    destination = Destination.Missions
                                    resetMissions()
                                    resetDecisions()
                                },
                                onViewDecisions = {
                                    destination = Destination.Decisions
                                    resetDecisions()
                                },
                                onViewMile = {
                                    destination = Destination.Mile
                                    resetMile()
                                },
                            )
                            Destination.Decisions -> DecisionHome(store) {
                                decisionId = it
                                decisionPage = DecisionPage.Weigh
                            }
                            Destination.Missions -> MissionHome(
                                store = store,
                                onCreate = { missionPage = MissionPage.Create },
                                onActive = {
                                    missionId = it
                                    missionStack = listOf(MissionStep.Detail)
                                },
                                onCompleted = {
                                    missionId = it
                                    missionStack = listOf(MissionStep.Completed)
                                },
                            )
                            Destination.Mile -> MileHome(
                                store = store,
                                onOutcomes = { mileStack = listOf(MileStep.Outcomes) },
                                onTrace = {
                                    mileEventId = it
                                    mileStack = listOf(MileStep.Trace)
                                },
                                onReport = { mileStack = listOf(MileStep.Report) },
                                onLifetime = { mileStack = listOf(MileStep.Lifetime) },
                            )
                        }
                    }
                }
                PillNav(
                    destination = destination,
                    onSelect = {
                        destination = it
                        page = LivePage.Home
                        resetMissions()
                        resetDecisions()
                        resetMile()
                        addStep = null
                    },
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .navigationBarsPadding()
                        .padding(horizontal = PersonalSpace.s28)
                        .padding(bottom = PersonalSpace.s8),
                )
                AddButton(
                    onClick = { addStep = AddStep.Sources },
                    modifier = Modifier
                        .align(Alignment.BottomEnd)
                        .navigationBarsPadding()
                        .padding(end = PersonalSpace.s28, bottom = 108.dp),
                )
            }
            if (deciding) {
                Column(Modifier.fillMaxSize().background(theme.palette.canvas).statusBarsPadding()) {
                DecisionFlow(
                    page = decisionPage,
                    decisionId = decisionId,
                    store = store,
                    api = api,
                    token = token,
                    onBack = {
                        decisionPage = when (decisionPage) {
                            DecisionPage.Solutions -> DecisionPage.Confirm
                            DecisionPage.Confirm -> DecisionPage.Weigh
                            else -> DecisionPage.Home
                        }
                    },
                    onContinue = { decisionPage = DecisionPage.Confirm },
                    onConfirm = { decisionPage = DecisionPage.Solutions },
                    onSave = { resetDecisions() },
                )
                }
            }
            if (destination == Destination.Missions && missionStack.isNotEmpty()) {
                MissionSheets(
                    store = store,
                    api = api,
                    token = token,
                    missionId = missionId,
                    stack = missionStack,
                    onChange = { missionStack = it },
                    onStarted = {
                        missionStack = emptyList()
                        missionPage = MissionPage.Home
                        scope.launch { store.prefetch() }
                    },
                    onOpenMile = {
                        destination = Destination.Mile
                        resetMissions()
                        resetMile()
                    },
                )
            }
            if (destination == Destination.Mile && mileStack.isNotEmpty()) {
                MileSheets(
                    store = store,
                    stack = mileStack,
                    outcomeId = mileOutcomeId,
                    eventId = mileEventId,
                    onChange = { mileStack = it },
                    onOutcome = {
                        mileOutcomeId = it
                        mileStack = mileStack + MileStep.Outcome
                    },
                    onOpenDecision = {
                        decisionId = it
                        decisionPage = DecisionPage.Weigh
                        destination = Destination.Decisions
                        resetMile()
                    },
                )
            }
            addStep?.let { step ->
                AddSheets(
                    api = api,
                    token = token,
                    step = step,
                    onStep = { addStep = it },
                    onClose = { addStep = null },
                    onImported = { scope.launch { store.invalidateAfterImport() } },
                    onViewTransactions = {
                        destination = Destination.Live
                        page = LivePage.Transactions
                        addStep = null
                        resetMissions()
                        resetDecisions()
                        resetMile()
                    },
                )
            }
        }
    }
}

@Composable
private fun LiveHeader(onSignOut: () -> Unit, onSettings: () -> Unit, onMoly: () -> Unit) {
    val theme = LocalPersonalTheme.current
    var menu by rememberSaveable { mutableStateOf(false) }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = PersonalSpace.s28)
            .padding(top = PersonalSpace.s32),
        verticalArrangement = Arrangement.spacedBy(PersonalSpace.s20),
    ) {
        Box {
            Wordmark(onClick = { menu = true })
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(
                    text = {
                        Text(
                            text = "Money settings",
                            fontFamily = theme.fontFamily,
                            fontWeight = FontWeight.SemiBold,
                            color = theme.palette.textPrimary,
                        )
                    },
                    onClick = {
                        menu = false
                        onSettings()
                    },
                )
                DropdownMenuItem(
                    text = {
                        Text(
                            text = "Sign out",
                            fontFamily = theme.fontFamily,
                            fontWeight = FontWeight.SemiBold,
                            color = theme.palette.textPrimary,
                        )
                    },
                    onClick = {
                        menu = false
                        onSignOut()
                    },
                )
            }
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = greeting(),
                color = if (theme.isDark) theme.palette.popoverBorder else theme.palette.textSecondary,
                fontFamily = theme.fontFamily,
                fontWeight = FontWeight.Medium,
                fontSize = 16.sp,
            )
            Row(
                modifier = Modifier
                    .clip(CircleShape)
                    .background(theme.action.default)
                    .clickable(onClick = onMoly)
                    .padding(horizontal = PersonalSpace.s16, vertical = PersonalSpace.s12),
                horizontalArrangement = Arrangement.spacedBy(PersonalSpace.s8),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    imageVector = Icons.Outlined.AutoAwesome,
                    contentDescription = null,
                    tint = theme.action.label,
                    modifier = Modifier.size(20.dp),
                )
                Text(
                    text = "MolyBot",
                    color = theme.action.label,
                    fontFamily = theme.fontFamily,
                    fontWeight = FontWeight.Bold,
                    fontSize = 16.sp,
                )
            }
        }
    }
}

@Composable
private fun Wordmark(onClick: () -> Unit) {
    Image(
        painter = painterResource(R.drawable.live_wordmark),
        contentDescription = "Monytix",
        contentScale = ContentScale.Fit,
        modifier = Modifier
            .height(27.dp)
            .clickable(onClick = onClick),
    )
}

@Composable
private fun PillNav(
    destination: Destination,
    onSelect: (Destination) -> Unit,
    modifier: Modifier = Modifier,
) {
    val theme = LocalPersonalTheme.current
    val shape = RoundedCornerShape(26.dp)
    Row(
        modifier = modifier
            .fillMaxWidth()
            .then(if (theme.isDark) Modifier else Modifier.shadow(12.dp, shape, clip = false))
            .clip(shape)
            .background(if (theme.isDark) Color(0xFF071124) else Color.White)
            .border(1.dp, if (theme.isDark) Color(0xFF344568) else Color(0xFFD9D7E6), shape)
            .padding(horizontal = 12.dp, vertical = 14.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Destination.entries.forEach { item ->
            val selected = destination == item
            val cell = RoundedCornerShape(18.dp)
            Column(
                modifier = Modifier
                    .weight(1f)
                    .height(68.dp)
                    .clip(cell)
                    .background(
                        when {
                            !selected -> Color.Transparent
                            theme.isDark -> theme.palette.popoverBorder.copy(alpha = 0.1f)
                            else -> Color(0xFFFFE2A7)
                        },
                    )
                    .clickable { onSelect(item) },
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Icon(
                    painter = painterResource(glyph(item.glyph, selected, theme.isDark)),
                    contentDescription = item.label,
                    tint = Color.Unspecified,
                    modifier = Modifier.size(20.dp),
                )
                Text(
                    text = item.label,
                    color = when {
                        selected && theme.isDark -> theme.palette.popoverBorder
                        selected -> theme.palette.textPrimary
                        theme.isDark -> Color(0xFFAEC0D9)
                        else -> theme.palette.textPrimary
                    },
                    fontFamily = theme.fontFamily,
                    fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
                    fontSize = 14.sp,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
        }
    }
}

private fun glyph(kind: Glyph, selected: Boolean, dark: Boolean): Int {
    return when (kind) {
        Glyph.Pulse -> when {
            selected && dark -> R.drawable.ic_nav_pulse_on_dark
            selected -> R.drawable.ic_nav_pulse_on_light
            else -> R.drawable.ic_nav_pulse
        }
        Glyph.Decisions -> when {
            selected && dark -> R.drawable.ic_nav_decisions_on_dark
            selected -> R.drawable.ic_nav_decisions_on_light
            dark -> R.drawable.ic_nav_decisions_dark
            else -> R.drawable.ic_nav_decisions_light
        }
        Glyph.Missions -> when {
            selected && dark -> R.drawable.ic_nav_missions_on_dark
            selected -> R.drawable.ic_nav_missions_on_light
            dark -> R.drawable.ic_nav_missions_dark
            else -> R.drawable.ic_nav_missions_light
        }
    }
}

private fun greeting(): String {
    val hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
    return when {
        hour < 12 -> "Good morning"
        hour < 17 -> "Good afternoon"
        else -> "Good evening"
    }
}

@Composable
private fun SystemBarContrast(dark: Boolean) {
    val view = LocalView.current
    if (view.isInEditMode) return
    SideEffect {
        val window = (view.context as Activity).window
        val controller = WindowCompat.getInsetsController(window, view)
        controller.isAppearanceLightStatusBars = !dark
        controller.isAppearanceLightNavigationBars = !dark
    }
}
