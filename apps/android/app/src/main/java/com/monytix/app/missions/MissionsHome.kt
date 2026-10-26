package com.monytix.app.missions

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.monytix.app.R
import com.monytix.app.auth.MonytixApi
import com.monytix.app.shell.UiSessionStore
import com.monytix.app.theme.FigIcon
import com.monytix.app.theme.LocalPersonalTheme
import com.monytix.app.theme.PersonalRadius
import com.monytix.app.theme.PersonalSpace
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.util.UUID

enum class MissionPage { Home, Create }

sealed class MissionStep {
    data class Options(val direction: String) : MissionStep()
    data class Setup(val name: String) : MissionStep()
    data object Detail : MissionStep()
    data object Progress : MissionStep()
    data object Milestone : MissionStep()
    data object History : MissionStep()
    data object Complete : MissionStep()
    data object Completed : MissionStep()
    data object SomethingElse : MissionStep()
}

private data class MissionRow(val id: String, val title: String?, val line: String?, val progress: String?, val fraction: Float)

private data class MissionList(val headline: String?, val summaryLine: String?, val pills: List<String>, val active: List<MissionRow>, val completed: List<MissionRow>) {
    companion object {
        fun empty() = MissionList(null, null, emptyList(), emptyList(), emptyList())

        fun parse(json: String): MissionList {
            return try {
                val root = JSONObject(json)
                val summary = root.optJSONObject("summary")
                val ready = summary?.optBoolean("available") == true
                MissionList(
                    headline = if (ready) text(summary, "headline") else null,
                    summaryLine = if (ready) text(summary, "line") else null,
                    pills = if (ready) texts(summary.optJSONArray("pills")) else emptyList(),
                    active = rows(root.optJSONArray("active")),
                    completed = rows(root.optJSONArray("completed")),
                )
            } catch (_: Exception) {
                empty()
            }
        }
    }
}

private data class MissionDetail(val title: String?, val line: String?, val progress: String?, val state: String?, val matters: String?, val impact: String?, val intelligence: String?, val recent: String?) {
    companion object {
        fun empty() = MissionDetail(null, null, null, null, null, null, null, null)

        fun parse(json: String?): MissionDetail {
            if (json.isNullOrBlank()) return empty()
            return try {
                val mission = JSONObject(json).optJSONObject("mission") ?: return empty()
                MissionDetail(text(mission, "title"), text(mission, "line"), text(mission, "progress"), text(mission, "state"), text(mission, "matters"), text(mission, "impact"), text(mission, "intelligence"), text(mission, "recent"))
            } catch (_: Exception) {
                empty()
            }
        }
    }
}

private data class MissionSetup(val title: String?, val basis: String?, val build: String?, val weights: List<String>, val decisions: List<String>) {
    companion object {
        fun empty() = MissionSetup(null, null, null, emptyList(), emptyList())

        fun parse(json: String?): MissionSetup {
            if (json.isNullOrBlank()) return empty()
            return try {
                val root = JSONObject(json)
                MissionSetup(text(root, "title"), text(root, "basis"), text(root, "build"), texts(root.optJSONArray("weights")), texts(root.optJSONArray("decisions")))
            } catch (_: Exception) {
                empty()
            }
        }
    }
}

private data class JournalEntry(val title: String?, val detail: String?)

private fun journal(json: String?): List<JournalEntry> {
    if (json.isNullOrBlank()) return emptyList()
    return try {
        val rows = JSONObject(json).optJSONArray("entries") ?: return emptyList()
        buildList {
            for (index in 0 until rows.length()) {
                val row = rows.optJSONObject(index) ?: continue
                add(JournalEntry(text(row, "title"), text(row, "detail")))
            }
        }
    } catch (_: Exception) {
        emptyList()
    }
}

private fun journalSince(json: String?): String? {
    if (json.isNullOrBlank()) return null
    return try {
        text(JSONObject(json), "since")
    } catch (_: Exception) {
        null
    }
}

private data class MissionCompletion(val title: String?, val changed: String?, val proof: String?, val unlocks: String?) {
    companion object {
        fun empty() = MissionCompletion(null, null, null, null)

        fun parse(json: String?): MissionCompletion {
            if (json.isNullOrBlank()) return empty()
            return try {
                val mission = JSONObject(json).optJSONObject("mission") ?: return empty()
                MissionCompletion(text(mission, "title"), text(mission, "changed"), text(mission, "proof"), text(mission, "unlocks"))
            } catch (_: Exception) {
                empty()
            }
        }
    }
}

private fun rows(array: org.json.JSONArray?): List<MissionRow> {
    if (array == null) return emptyList()
    return buildList {
        for (index in 0 until array.length()) {
            val row = array.optJSONObject(index) ?: continue
            val id = row.optString("id")
            if (id.isBlank()) continue
            add(MissionRow(id, text(row, "title"), text(row, "line"), text(row, "progress"), row.optDouble("progress_fraction", 0.0).toFloat().coerceIn(0f, 1f)))
        }
    }
}

private fun texts(array: org.json.JSONArray?): List<String> {
    if (array == null) return emptyList()
    return buildList {
        for (index in 0 until array.length()) {
            val value = array.optString(index)
            if (value.isNotBlank()) add(value)
        }
    }
}

private fun text(obj: JSONObject?, key: String): String? = obj?.optString(key).orEmpty().ifBlank { null }

private data class CatalogMission(val name: String, val code: String)

private data class Direction(
    val name: String,
    val line: String,
    val focus: String,
    val prompt: String,
    val missions: List<CatalogMission>,
)

private val directions = listOf(
    Direction(
        "Build Safety",
        "Emergency buffer · protection",
        "Build an Emergency Buffer",
        "Choose the safety outcome you want to build.",
        listOf(
            CatalogMission("Build an Emergency Buffer", "M01"),
            CatalogMission("Build an Income-Loss Buffer", "M02"),
            CatalogMission("Build a Medical Reserve", "M03"),
            CatalogMission("Strengthen Insurance Protection", "M04"),
            CatalogMission("Prepare for an Unexpected Expense", "M05"),
            CatalogMission("Build 6–12 Months of Security", "M06"),
        ),
    ),
    Direction(
        "Reduce Debt",
        "Cards · loans · commitments",
        "Pay Off a Personal Loan Faster",
        "Choose the debt outcome you want to work toward.",
        listOf(
            CatalogMission("Clear Credit-Card Debt", "M07"),
            CatalogMission("Pay Off a Personal Loan Faster", "M08"),
            CatalogMission("Reduce Home-Loan Burden", "M09"),
            CatalogMission("Reduce EMI Pressure", "M10"),
            CatalogMission("Cut Recurring Commitments", "M11"),
            CatalogMission("Become Debt-Free", "M12"),
        ),
    ),
    Direction(
        "Save for Something",
        "Home · vehicle · education",
        "Build an Education Fund",
        "Choose what you want to prepare and save for.",
        listOf(
            CatalogMission("Build a Home Fund", "M13"),
            CatalogMission("Save for a Vehicle", "M14"),
            CatalogMission("Build an Education Fund", "M15"),
            CatalogMission("Save for a Wedding", "M16"),
            CatalogMission("Build a Travel Fund", "M17"),
            CatalogMission("Fund a Major Purchase", "M18"),
        ),
    ),
    Direction(
        "Build Wealth",
        "Investing · retirement",
        "Build a Long-Term Corpus",
        "Choose the wealth outcome you want to build.",
        listOf(
            CatalogMission("Start Investing Regularly", "M19"),
            CatalogMission("Increase My SIP", "M20"),
            CatalogMission("Put Idle Cash to Work", "M21"),
            CatalogMission("Build a Long-Term Corpus", "M22"),
            CatalogMission("Keep My Portfolio Balanced", "M23"),
            CatalogMission("Build My Retirement Corpus", "M24"),
        ),
    ),
    Direction(
        "Improve Spending",
        "Dining · shopping · leakage",
        "Reduce Discretionary Spending",
        "Choose the spending pattern you want to improve.",
        listOf(
            CatalogMission("Reduce Dining Spend", "M25"),
            CatalogMission("Control Shopping Spend", "M26"),
            CatalogMission("Reduce Entertainment Spend", "M27"),
            CatalogMission("Keep Travel Spending Under Control", "M28"),
            CatalogMission("Reduce Discretionary Spending", "M29"),
            CatalogMission("Stop Financial Leakage", "M30"),
        ),
    ),
    Direction(
        "Improve Cash Flow",
        "Salary · surplus · large expenses",
        "Increase My Savings Rate",
        "Choose the cash-flow outcome you want to improve.",
        listOf(
            CatalogMission("Allocate My Salary Better", "M31"),
            CatalogMission("Put Monthly Surplus to Work", "M32"),
            CatalogMission("Avoid a Cash Crunch", "M33"),
            CatalogMission("Prepare for a Large Upcoming Expense", "M34"),
            CatalogMission("Use a Bonus or Windfall Better", "M35"),
            CatalogMission("Increase My Savings Rate", "M36"),
        ),
    ),
    Direction(
        "Support Life & Family",
        "Children · parents · healthcare",
        "Support Life & Family",
        "Choose the life or family outcome you want to prepare for.",
        listOf(
            CatalogMission("Build a Fund for My Children", "M37"),
            CatalogMission("Support My Parents", "M38"),
            CatalogMission("Prepare for Family Healthcare", "M39"),
            CatalogMission("Prepare for Family Education", "M40"),
            CatalogMission("Build a Family Safety Net", "M41"),
            CatalogMission("Prepare for a Family Milestone", "M42"),
        ),
    ),
    Direction(
        "Create Freedom",
        "Career break · business · independence",
        "Create Freedom",
        "Choose the freedom you want your finances to help create.",
        listOf(
            CatalogMission("Prepare for a Career Break", "M43"),
            CatalogMission("Prepare to Start a Business", "M44"),
            CatalogMission("Prepare to Relocate", "M45"),
            CatalogMission("Work Toward Financial Independence", "M46"),
            CatalogMission("Retire Earlier", "M47"),
            CatalogMission("Build More Financial Flexibility", "M48"),
        ),
    ),
)

private val crossLinks = listOf(
    "Support Life & Family" to "Children · parents · healthcare",
    "Create Freedom" to "Career break · business · independence",
)

@Composable
fun MissionHome(
    store: UiSessionStore,
    onCreate: () -> Unit,
    onActive: (String) -> Unit,
    onCompleted: (String) -> Unit,
) {
    val theme = LocalPersonalTheme.current
    val list = remember(store.missionsJson) {
        val json = store.missionsJson
        if (json.isNullOrBlank()) MissionList.empty() else MissionList.parse(json)
    }
    LaunchedEffect(Unit) { store.refreshMissions() }
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = PersonalSpace.s20)
            .padding(top = PersonalSpace.s20, bottom = 128.dp),
        verticalArrangement = Arrangement.spacedBy(PersonalSpace.s20),
    ) {
        Column {
            Text("Missions", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 22.sp)
            Text("The things you’ve chosen to make happen.", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
        }
        if (list.active.isEmpty()) {
            Text("Nothing is active yet.", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
        } else {
            SurfaceCard {
                list.summaryLine?.let { Text(it, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp) }
                Text(list.headline ?: "Active missions", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
                if (list.pills.isNotEmpty()) {
                    Row(horizontalArrangement = Arrangement.spacedBy(PersonalSpace.s8)) {
                        list.pills.forEach { StatusPill(it) }
                    }
                }
            }
            Text("ACTIVE", color = eyebrow(), fontFamily = theme.fontFamily, fontWeight = FontWeight.ExtraBold, fontSize = 13.sp)
            list.active.forEachIndexed { index, row ->
                val icon = listOf(R.drawable.fig_shield_plus, R.drawable.fig_mission_emblem, R.drawable.fig_utensils)[index % 3]
                ActiveCard(row, icon) { onActive(row.id) }
            }
        }
        list.completed.firstOrNull()?.let { completed ->
            Row(
                modifier = Modifier.fillMaxWidth().clickable { onCompleted(completed.id) },
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                FigIcon(R.drawable.fig_cash_check, 18.dp)
                Text("  Completed Missions", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
            }
        }
        Gold("Create a Mission", onClick = onCreate)
    }
}

@Composable
fun MissionCreate(onBack: () -> Unit, onDirection: (String) -> Unit, onSomethingElse: () -> Unit) {
    val theme = LocalPersonalTheme.current
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(theme.palette.canvas)
            .verticalScroll(rememberScrollState())
            .navigationBarsPadding()
            .padding(horizontal = PersonalSpace.s20)
            .padding(top = PersonalSpace.s16, bottom = PersonalSpace.s32),
        verticalArrangement = Arrangement.spacedBy(PersonalSpace.s16),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(PersonalSpace.s12)) {
            CircleButton(onBack) {
                Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back", tint = theme.palette.textPrimary)
            }
            Text("Create a Mission", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 22.sp)
        }
        Text("What do you want to make happen?", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
        Text("Choose the closest direction. You can make it yours on the next step.", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
        directions.chunked(2).forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(PersonalSpace.s12)) {
                row.forEach { direction ->
                    SurfaceCard(Modifier.weight(1f).clickable { onDirection(direction.name) }) {
                        Text(direction.name, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                        Text(direction.line, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
                    }
                }
            }
        }
        SurfaceCard(Modifier.clickable(onClick = onSomethingElse)) {
            Text("Something else", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 15.sp)
            Text("Tell Monytix in your own words", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
        }
    }
}

@Composable
fun MissionSheets(
    api: MonytixApi,
    token: suspend (Boolean) -> String?,
    missionId: String,
    stack: List<MissionStep>,
    onChange: (List<MissionStep>) -> Unit,
    onStarted: () -> Unit,
    onOpenMile: () -> Unit,
) {
    val step = stack.lastOrNull() ?: return
    val theme = LocalPersonalTheme.current
    var detail by remember { mutableStateOf(MissionDetail.empty()) }
    var entries by remember { mutableStateOf(emptyList<JournalEntry>()) }
    var since by remember { mutableStateOf<String?>(null) }
    var completion by remember { mutableStateOf(MissionCompletion.empty()) }
    var reload by remember { mutableStateOf(0) }
    LaunchedEffect(missionId, reload) {
        if (missionId.isBlank()) {
            detail = MissionDetail.empty()
            entries = emptyList()
            since = null
            completion = MissionCompletion.empty()
            return@LaunchedEffect
        }
        val journalJson = api.getJson("/v1/ui/missions/$missionId/journal", token)
        detail = MissionDetail.parse(api.getJson("/v1/ui/missions/$missionId", token))
        entries = journal(journalJson)
        since = journalSince(journalJson)
        completion = MissionCompletion.parse(api.getJson("/v1/ui/missions/$missionId/completion", token))
    }
    fun pop() { onChange(stack.dropLast(1)) }
    fun push(next: MissionStep) { onChange(stack + next) }
    fun replace(next: MissionStep) { onChange(stack.dropLast(1) + next) }
    Box(Modifier.fillMaxSize()) {
        Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.55f)).clickable { pop() })
        Column(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .fillMaxHeight(0.92f)
                .clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp))
                .background(theme.palette.sheet)
                .verticalScroll(rememberScrollState())
                .navigationBarsPadding()
                .padding(PersonalSpace.s20),
            verticalArrangement = Arrangement.spacedBy(PersonalSpace.s16),
        ) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text(sheetTitle(step, detail.title ?: completion.title), color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 22.sp, modifier = Modifier.weight(1f))
                CircleButton(::pop) {
                    Icon(Icons.Outlined.Close, contentDescription = "Close", tint = theme.palette.textPrimary)
                }
            }
            when (step) {
                is MissionStep.Options -> OptionsBody(step.direction, onMission = { push(MissionStep.Setup(it)) }, onDirection = { replace(MissionStep.Options(it)) }, onBack = ::pop)
                is MissionStep.Setup -> SetupBody(api, token, step.name, onStarted)
                MissionStep.Detail -> DetailBody(detail, onProgress = { push(MissionStep.Progress) }, onHistory = { push(MissionStep.History) }, onMilestone = { push(MissionStep.Milestone) }, onComplete = { push(MissionStep.Complete) })
                MissionStep.Progress -> ProgressBody(api, token, missionId, detail) { reload += 1; pop() }
                MissionStep.Milestone -> MilestoneBody(detail, ::pop)
                MissionStep.History -> HistoryBody(since ?: detail.progress, entries)
                MissionStep.Complete -> CompleteBody(completion) {
                    onChange(emptyList())
                    onOpenMile()
                }
                MissionStep.Completed -> CompletedBody(detail) { push(MissionStep.History) }
                MissionStep.SomethingElse -> SomethingElseBody()
            }
        }
    }
}

@Composable
private fun OptionsBody(directionName: String, onMission: (String) -> Unit, onDirection: (String) -> Unit, onBack: () -> Unit) {
    val direction = directions.first { it.name == directionName }
    val theme = LocalPersonalTheme.current
    Text(direction.focus, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
    Text(direction.prompt, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
    direction.missions.chunked(2).forEach { row ->
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(PersonalSpace.s12)) {
            row.forEach { mission ->
                SurfaceCard(Modifier.weight(1f).clickable { onMission(mission.name) }) {
                    Text(mission.name, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                }
            }
        }
    }
    crossLinks.forEach { (name, line) ->
        SurfaceCard(Modifier.clickable { onDirection(name) }) {
            Text(name, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 15.sp)
            Text(line, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
        }
    }
    SurfaceCard(Modifier.clickable(onClick = onBack)) {
        Text("Back to Mission directions", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 15.sp)
        Text("Choose a different Mission category", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
    }
}

@Composable
private fun SetupBody(api: MonytixApi, token: suspend (Boolean) -> String?, name: String, onStarted: () -> Unit) {
    val theme = LocalPersonalTheme.current
    val scope = rememberCoroutineScope()
    val code = directions.flatMap { it.missions }.firstOrNull { it.name == name }?.code
    var setup by remember(name) { mutableStateOf(MissionSetup.empty()) }
    var current by remember(name) { mutableStateOf("") }
    var reach by remember(name) { mutableStateOf("") }
    var posting by remember { mutableStateOf(false) }
    LaunchedEffect(code) {
        setup = if (code == null) MissionSetup.empty() else MissionSetup.parse(api.getJson("/v1/ui/missions/definitions/$code", token))
    }
    Text(setup.title ?: name, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
    Text("A few details help Monytix understand what progress means.", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
    Text("YOUR TARGET", color = eyebrow(), fontFamily = theme.fontFamily, fontWeight = FontWeight.ExtraBold, fontSize = 13.sp)
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(PersonalSpace.s12)) {
        AmountField("Current", current, Modifier.weight(1f)) { current = it }
        AmountField("Reach", reach, Modifier.weight(1f)) { reach = it }
    }
    Text("How Monytix understands this", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
    Text(setup.basis ?: "Choose a reach amount.", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
    if (setup.weights.isNotEmpty()) {
        Row(horizontalArrangement = Arrangement.spacedBy(PersonalSpace.s8)) {
            setup.weights.forEach { StatusPill(it) }
        }
    }
    if (setup.decisions.isNotEmpty()) {
        Text("Related decisions  ${setup.decisions.joinToString(" · ")}", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
    }
    Text("HOW DO YOU WANT TO BUILD IT?", color = eyebrow(), fontFamily = theme.fontFamily, fontWeight = FontWeight.ExtraBold, fontSize = 13.sp)
    Text(setup.build ?: "Use what you already have.", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
    Text("You can change this anytime.", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
    val reachValue = reach.replace(",", "").toDoubleOrNull()
    Gold("Start Mission", enabled = reachValue != null && reachValue > 0 && !posting) {
        val selected = code ?: return@Gold
        val amount = reachValue ?: return@Gold
        posting = true
        scope.launch {
            val body = JSONObject()
                .put("canonical_mission_code", selected)
                .put("reach_amount", amount)
                .put("current_amount", current.replace(",", "").toDoubleOrNull() ?: 0)
            val result = api.submit("POST", "/v1/missions", body.toString(), "mission-create-$selected", token)
            posting = false
            if (result.status in 200..299) onStarted()
        }
    }
}

@Composable
private fun DetailBody(detail: MissionDetail, onProgress: () -> Unit, onHistory: () -> Unit, onMilestone: () -> Unit, onComplete: () -> Unit) {
    val theme = LocalPersonalTheme.current
    detail.line?.let { Text(it, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 14.sp) }
    Row(horizontalArrangement = Arrangement.spacedBy(PersonalSpace.s8)) {
        StatusPill(detail.progress ?: "Started")
        StatusPill(if (detail.state == "completed") "Complete" else "Active")
    }
    Text(detail.title ?: "Mission", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
    Section("WHAT MATTERS NOW", detail.matters)
    Section("M.I.L.E. IMPACT", detail.impact)
    Section("CONNECTED INTELLIGENCE", detail.intelligence)
    Section("RECENT PROGRESS", detail.recent)
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(PersonalSpace.s12)) {
        TextLink("View Mission history", Modifier.weight(1f), onHistory)
        TextLink("View latest milestone", Modifier.weight(1f), onMilestone)
    }
    TextLink("Mission complete", Modifier.fillMaxWidth(), onComplete)
    Gold("Add progress", onClick = onProgress)
}

@Composable
private fun ProgressBody(api: MonytixApi, token: suspend (Boolean) -> String?, missionId: String, detail: MissionDetail, onSaved: () -> Unit) {
    val theme = LocalPersonalTheme.current
    val scope = rememberCoroutineScope()
    var amount by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    var posting by remember { mutableStateOf(false) }
    Text("HOW MUCH PROGRESS?", color = eyebrow(), fontFamily = theme.fontFamily, fontWeight = FontWeight.ExtraBold, fontSize = 13.sp)
    AmountField("Amount", amount, Modifier.fillMaxWidth()) { amount = it }
    Text("WHERE DID THIS COME FROM?", color = eyebrow(), fontFamily = theme.fontFamily, fontWeight = FontWeight.ExtraBold, fontSize = 13.sp)
    Text("You are recording progress on ${detail.title ?: "this mission"}.", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
    Text("IF YOU ADD THIS", color = eyebrow(), fontFamily = theme.fontFamily, fontWeight = FontWeight.ExtraBold, fontSize = 13.sp)
    Text(detail.progress ?: "Started", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
    Text("NOTE · OPTIONAL", color = eyebrow(), fontFamily = theme.fontFamily, fontWeight = FontWeight.ExtraBold, fontSize = 13.sp)
    NoteField("Add a note", note) { note = it }
    val value = amount.replace(",", "").toDoubleOrNull()
    Gold("Add progress", enabled = value != null && value > 0 && missionId.isNotBlank() && !posting) {
        val progress = value ?: return@Gold
        posting = true
        scope.launch {
            val body = JSONObject().put("action", "ADD_PROGRESS").put("amount", progress)
            if (note.isNotBlank()) body.put("note", note)
            val result = api.submit("POST", "/v1/missions/$missionId/actions", body.toString(), "mission-progress-$missionId-${UUID.randomUUID()}", token)
            posting = false
            if (result.status in 200..299) onSaved()
        }
    }
}

@Composable
private fun MilestoneBody(detail: MissionDetail, onContinue: () -> Unit) {
    Section("VERIFIED IMPACT", detail.recent)
    Section("WHY THIS COUNTS", detail.matters)
    Section("NEXT MARKER", if (detail.state == "completed") "Target reached" else "Keep going toward the reach amount")
    Gold("Continue Mission", onClick = onContinue)
}

@Composable
private fun HistoryBody(since: String?, entries: List<JournalEntry>) {
    val theme = LocalPersonalTheme.current
    Section("SINCE YOU STARTED", since)
    Text("TIMELINE", color = eyebrow(), fontFamily = theme.fontFamily, fontWeight = FontWeight.ExtraBold, fontSize = 13.sp)
    if (entries.isEmpty()) {
        Text("No progress recorded yet.", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
    } else {
        entries.forEach { entry ->
            SurfaceCard {
                Text(entry.title ?: "Progress", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                Text(entry.detail ?: "Progress recorded", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
            }
        }
    }
    Text("Every MILE can be traced back to real progress.", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 14.sp)
}

@Composable
private fun CompleteBody(completion: MissionCompletion, onMile: () -> Unit) {
    Section("WHAT CHANGED", completion.changed)
    Section("OUTCOME PROOF", completion.proof)
    Section("WHAT THIS UNLOCKS", completion.unlocks)
    Gold("See my M.I.L.E.", onClick = onMile)
}

@Composable
private fun CompletedBody(detail: MissionDetail, onHistory: () -> Unit) {
    val theme = LocalPersonalTheme.current
    detail.line?.let { Text(it, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 14.sp) }
    StatusPill(detail.progress ?: "Complete")
    Text(detail.title ?: "Mission", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
    Section("MISSION RECORD", detail.title)
    Section("INTELLIGENCE RECORD", detail.intelligence)
    Section("IMPACT TRACE", detail.impact)
    TextLink("View full history", Modifier.fillMaxWidth(), onHistory)
}

@Composable
private fun SomethingElseBody() {
    val theme = LocalPersonalTheme.current
    var words by remember { mutableStateOf("") }
    Text("Tell Monytix in your own words", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
    Text("This note stays on this screen. It does not create a new mission.", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
    NoteField("Describe what you want to make happen", words) { words = it }
}

private fun sheetTitle(step: MissionStep, name: String?) = when (step) {
    is MissionStep.Options, is MissionStep.Setup, MissionStep.SomethingElse -> "Create a Mission"
    MissionStep.Detail -> name ?: "Mission"
    MissionStep.Progress -> "Add progress"
    MissionStep.Milestone -> "A milestone reached"
    MissionStep.History -> "Mission history"
    MissionStep.Complete -> "Mission complete"
    MissionStep.Completed -> name ?: "Mission"
}

@Composable
private fun ActiveCard(row: MissionRow, icon: Int, onOpen: () -> Unit) {
    val theme = LocalPersonalTheme.current
    SurfaceCard(Modifier.clickable(onClick = onOpen)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(PersonalSpace.s12)) {
            FigIcon(icon, 48.dp)
            Column(Modifier.weight(1f)) {
                Text(row.title ?: "Mission", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                Text(row.line ?: "In progress", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 14.sp)
            }
            Text(row.progress ?: "Started", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
        }
        Box(Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(PersonalRadius.pill)).background(theme.palette.border)) {
            Box(Modifier.fillMaxHeight().fillMaxWidth(row.fraction.coerceAtLeast(0.04f)).background(theme.action.default))
        }
        row.line?.let { Text(it, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp) }
    }
}

@Composable
private fun Section(title: String, value: String? = null) {
    val theme = LocalPersonalTheme.current
    Text(title, color = eyebrow(), fontFamily = theme.fontFamily, fontWeight = FontWeight.ExtraBold, fontSize = 13.sp)
    if (!value.isNullOrBlank()) {
        Text(value, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
    }
}

@Composable
private fun SurfaceCard(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val theme = LocalPersonalTheme.current
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(PersonalRadius.card))
            .background(theme.palette.surface)
            .border(1.dp, theme.palette.border, RoundedCornerShape(PersonalRadius.card))
            .padding(PersonalSpace.s16),
        verticalArrangement = Arrangement.spacedBy(PersonalSpace.s8),
        content = { content() },
    )
}

@Composable
private fun StatusPill(label: String) {
    val theme = LocalPersonalTheme.current
    Text(
        label,
        modifier = Modifier
            .clip(CircleShape)
            .background(if (theme.isDark) theme.palette.surfaceRaised else theme.status.lavender)
            .padding(horizontal = PersonalSpace.s12, vertical = PersonalSpace.s8),
        color = if (theme.isDark) theme.palette.popoverBorder else theme.palette.textPrimary,
        fontFamily = theme.fontFamily,
        fontWeight = FontWeight.Bold,
        fontSize = 12.sp,
    )
}

@Composable
private fun Gold(label: String, enabled: Boolean = true, onClick: () -> Unit) {
    val theme = LocalPersonalTheme.current
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(48.dp)
            .clip(RoundedCornerShape(PersonalRadius.action))
            .background(theme.action.default.copy(alpha = if (enabled) 1f else 0.4f))
            .then(if (enabled) Modifier.clickable(onClick = onClick) else Modifier),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = theme.action.label, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 15.sp)
    }
}

@Composable
private fun AmountField(label: String, value: String, modifier: Modifier, onChange: (String) -> Unit) {
    val theme = LocalPersonalTheme.current
    SurfaceCard(modifier) {
        Text(label, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
        BasicTextField(
            value = value,
            onValueChange = onChange,
            textStyle = TextStyle(color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 15.sp),
            cursorBrush = SolidColor(theme.palette.textPrimary),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            decorationBox = { inner ->
                if (value.isEmpty()) Text("0", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
                inner()
            },
        )
    }
}

@Composable
private fun NoteField(hint: String, value: String, onChange: (String) -> Unit) {
    val theme = LocalPersonalTheme.current
    BasicTextField(
        value = value,
        onValueChange = onChange,
        textStyle = TextStyle(color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontSize = 15.sp),
        cursorBrush = SolidColor(theme.palette.textPrimary),
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(PersonalRadius.action))
            .background(theme.palette.surface)
            .border(1.dp, theme.palette.border, RoundedCornerShape(PersonalRadius.action))
            .padding(PersonalSpace.s16),
        decorationBox = { inner ->
            if (value.isEmpty()) Text(hint, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
            inner()
        },
    )
}

@Composable
private fun TextLink(label: String, modifier: Modifier, onClick: () -> Unit) {
    val theme = LocalPersonalTheme.current
    Text(
        label,
        color = theme.palette.textPrimary,
        fontFamily = theme.fontFamily,
        fontWeight = FontWeight.SemiBold,
        fontSize = 14.sp,
        modifier = modifier
            .clip(RoundedCornerShape(PersonalRadius.action))
            .border(1.dp, theme.palette.border, RoundedCornerShape(PersonalRadius.action))
            .clickable(onClick = onClick)
            .padding(vertical = PersonalSpace.s12),
    )
}

@Composable
private fun CircleButton(onClick: () -> Unit, content: @Composable () -> Unit) {
    val theme = LocalPersonalTheme.current
    Box(
        modifier = Modifier.size(40.dp).clip(CircleShape).background(theme.palette.surface).border(1.dp, theme.palette.border, CircleShape).clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
        content = { content() },
    )
}

@Composable
private fun eyebrow() = with(LocalPersonalTheme.current) {
    if (isDark) palette.popoverBorder else palette.textPrimary
}
