package com.monytix.app.add

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
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
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.monytix.app.auth.MonytixApi
import com.monytix.app.theme.LocalPersonalTheme
import com.monytix.app.theme.PersonalRadius
import com.monytix.app.theme.PersonalSpace
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.security.MessageDigest
import java.util.UUID

enum class AddStep { Sources, Upload, Processing, Success, Offline }

private const val Unavailable = "Unavailable"
private const val MaxBytes = 10_485_760
private val banks = listOf("HDFC", "ICICI", "SBI", "AXIS", "KOTAK", "YES", "+ More")

private data class ChosenFile(val name: String, val type: String, val bytes: ByteArray)

private data class ImportStatus(val count: String?, val stage: String?, val reached: Boolean, val done: Boolean)

@Composable
fun AddButton(onClick: () -> Unit, modifier: Modifier = Modifier) {
    val theme = LocalPersonalTheme.current
    Box(
        modifier
            .size(56.dp)
            .clip(CircleShape)
            .background(theme.action.default)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(Icons.Outlined.Add, contentDescription = "Add data", tint = theme.action.label)
    }
}

@Composable
fun AddSheets(
    api: MonytixApi,
    token: suspend (Boolean) -> String?,
    step: AddStep,
    onStep: (AddStep) -> Unit,
    onClose: () -> Unit,
    onViewTransactions: () -> Unit,
) {
    val theme = LocalPersonalTheme.current
    val context = LocalContext.current
    var chosen by remember { mutableStateOf<ChosenFile?>(null) }
    var status by remember { mutableStateOf(ImportStatus(null, null, false, false)) }
    var attempt by remember { mutableIntStateOf(0) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        chosen = uri?.let { readStatement(context, it) }
    }
    val scope = rememberCoroutineScope()
    var gmailNote by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(step, attempt) {
        val file = chosen
        if (step != AddStep.Processing || file == null) return@LaunchedEffect
        val outcome = uploadStatement(api, token, file)
        status = outcome
        if (!outcome.reached) onStep(AddStep.Offline) else if (outcome.done) onStep(AddStep.Success)
    }
    Box(Modifier.fillMaxSize()) {
        Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.55f)).clickable(onClick = onClose))
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
                Text(title(step), color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 22.sp, modifier = Modifier.weight(1f))
                CircleButton(onClose) {
                    Icon(Icons.Outlined.Close, contentDescription = "Close", tint = theme.palette.textPrimary)
                }
            }
            when (step) {
                AddStep.Sources -> SourcesBody(
                    onStatement = { onStep(AddStep.Upload) },
                    onGmail = {
                        scope.launch {
                            gmailNote = if (openGmail(api, token, context)) null else Unavailable
                        }
                    },
                    gmailNote = gmailNote,
                )
                AddStep.Upload -> UploadBody(
                    chosen = chosen,
                    onPick = { picker.launch(arrayOf("application/pdf", "text/csv", "text/comma-separated-values")) },
                    onUpload = { if (chosen != null) onStep(AddStep.Processing) },
                )
                AddStep.Processing -> ProcessingBody(status)
                AddStep.Success -> SuccessBody(status, onViewTransactions, onClose)
                AddStep.Offline -> OfflineBody(
                    onRetry = { attempt += 1; onStep(AddStep.Processing) },
                    onOffline = onClose,
                )
            }
        }
    }
}

private fun title(step: AddStep) = when (step) {
    AddStep.Sources -> "Add data"
    AddStep.Upload -> "Upload PDF Statement"
    AddStep.Processing -> "Reading your statement"
    AddStep.Success -> "Connected Successfully!"
    AddStep.Offline -> "Lost in the Fog"
}

@Composable
private fun SourcesBody(onStatement: () -> Unit, onGmail: () -> Unit, gmailNote: String?) {
    val theme = LocalPersonalTheme.current
    SourceRow("Bank statement", "PDF or CSV", onStatement)
    SourceRow("Gmail", "Connect", onGmail)
    SourceRow("Account Aggregator", "Coming soon", null)
    if (gmailNote != null) {
        Text(gmailNote, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
    }
}

private suspend fun openGmail(
    api: MonytixApi,
    token: suspend (Boolean) -> String?,
    context: android.content.Context,
): Boolean {
    val response = api.submit("GET", "/gmail/oauth/start", null, null, token)
    if (response.status !in 200..299) return false
    val url = JSONObject(response.text ?: return false).optString("url")
    if (url.isBlank()) return false
    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
    return true
}

@Composable
private fun SourceRow(title: String, line: String, onClick: (() -> Unit)?) {
    val theme = LocalPersonalTheme.current
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(PersonalRadius.card))
            .background(theme.palette.surface)
            .border(1.dp, theme.palette.border, RoundedCornerShape(PersonalRadius.card))
            .then(if (onClick == null) Modifier else Modifier.clickable(onClick = onClick))
            .padding(PersonalSpace.s16),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(title, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 16.sp)
        Text(line, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun UploadBody(chosen: ChosenFile?, onPick: () -> Unit, onUpload: () -> Unit) {
    val theme = LocalPersonalTheme.current
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(PersonalRadius.card))
            .border(1.dp, theme.palette.border, RoundedCornerShape(PersonalRadius.card))
            .clickable(onClick = onPick)
            .padding(PersonalSpace.s16),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(PersonalSpace.s8),
    ) {
        Text(chosen?.name ?: "Drag or tap to select your PDF/csv statement", color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
        Text("(Max 10MB, password-protected supported)", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 13.sp)
    }
    Text("SUPPORTED BANKS", color = eyebrow(), fontFamily = theme.fontFamily, fontWeight = FontWeight.ExtraBold, fontSize = 13.sp)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(PersonalSpace.s8), verticalArrangement = Arrangement.spacedBy(PersonalSpace.s8)) {
        banks.forEach { name ->
            Text(
                name,
                color = theme.palette.textSecondary,
                fontFamily = theme.fontFamily,
                fontWeight = FontWeight.Bold,
                fontSize = 12.sp,
                modifier = Modifier
                    .clip(CircleShape)
                    .border(1.dp, theme.palette.border, CircleShape)
                    .padding(horizontal = PersonalSpace.s12, vertical = PersonalSpace.s8),
            )
        }
    }
    Gold("Upload & Process  →", chosen != null, onUpload)
}

@Composable
private fun ProcessingBody(status: ImportStatus) {
    val theme = LocalPersonalTheme.current
    Text("While we parse your statement, we're mapping the patterns behind those choices.", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 14.sp)
    Text(status.count ?: Unavailable, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
    Text(status.stage ?: Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 14.sp)
    listOf("File uploaded", "Parsing transactions", "Categorizing entries", "Assigning weights").forEach { label ->
        Text(label, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontSize = 14.sp)
    }
}

@Composable
private fun SuccessBody(status: ImportStatus, onViewTransactions: () -> Unit, onAutoSync: () -> Unit) {
    val theme = LocalPersonalTheme.current
    Text(Unavailable, color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 14.sp)
    Text(status.count ?: Unavailable, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
    Text("Monytix is now assigning weights to your decisions.", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 14.sp)
    Gold("View Transactions  →", true, onViewTransactions)
    Outlined("Set Up Auto-Sync", onAutoSync)
}

@Composable
private fun OfflineBody(onRetry: () -> Unit, onOffline: () -> Unit) {
    val theme = LocalPersonalTheme.current
    Text("No internet connection. Your data is safe — we just can't sync right now.", color = theme.palette.textSecondary, fontFamily = theme.fontFamily, fontSize = 15.sp)
    Gold("Try to Reconnect  →", true, onRetry)
    Outlined("Use Offline Mode", onOffline)
}

private suspend fun uploadStatement(api: MonytixApi, token: suspend (Boolean) -> String?, file: ChosenFile): ImportStatus {
    val digest = sha256(file.bytes)
    val created = api.submit(
        "POST",
        "/v1/imports",
        """{"file_type":"${file.type}","byte_size":${file.bytes.size},"sha256":"$digest","original_filename":${JSONObject.quote(file.name)}}""",
        UUID.randomUUID().toString(),
        token,
    )
    if (created.status == 0) return ImportStatus(null, null, false, false)
    if (created.status !in 200..299) return ImportStatus(null, null, true, false)
    val root = JSONObject(created.text ?: return ImportStatus(null, null, true, false))
    val data = root.optJSONObject("data") ?: return ImportStatus(null, null, true, false)
    val importId = data.optString("import_id")
    val upload = data.optJSONObject("upload")
    val url = upload?.optString("url").orEmpty()
    if (importId.isBlank() || url.isBlank()) return ImportStatus(null, null, true, false)
    val headers = mutableMapOf<String, String>()
    val headerObject = upload?.optJSONObject("headers")
    headerObject?.keys()?.forEach { key -> headers[key] = headerObject.optString(key) }
    val mime = data.optString("declared_mime_type").ifBlank { if (file.type == "PDF") "application/pdf" else "text/csv" }
    val put = api.putSigned(url, headers, file.bytes, mime)
    if (put == 0) return ImportStatus(null, null, false, false)
    if (put !in 200..299) return ImportStatus(null, null, true, false)
    val completed = api.submit("POST", "/v1/imports/$importId/complete", null, UUID.randomUUID().toString(), token)
    if (completed.status == 0) return ImportStatus(null, null, false, false)
    if (completed.status !in 200..299) return ImportStatus(null, null, true, false)
    val status = api.submit("GET", "/v1/imports/$importId/status", null, null, token)
    if (status.status == 0) return ImportStatus(null, null, false, false)
    return readStatus(status.text)
}

private fun readStatus(json: String?): ImportStatus {
    if (json.isNullOrBlank()) return ImportStatus(null, null, true, true)
    return try {
        val data = JSONObject(json).optJSONObject("data")
        val count = data?.opt("imported_transaction_count")?.toString()?.takeIf { it.isNotBlank() && it != "null" }
        val stage = data?.optString("stage").orEmpty().ifBlank { null }
        ImportStatus(count, stage, true, true)
    } catch (_: Exception) {
        ImportStatus(null, null, true, true)
    }
}

private fun readStatement(context: android.content.Context, uri: Uri): ChosenFile? {
    val name = context.contentResolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
        if (!cursor.moveToFirst()) return@use null
        cursor.getString(0)
    } ?: uri.lastPathSegment ?: return null
    val type = when {
        name.endsWith(".pdf", true) -> "PDF"
        name.endsWith(".csv", true) -> "CSV"
        else -> return null
    }
    val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: return null
    if (bytes.isEmpty() || bytes.size > MaxBytes) return null
    return ChosenFile(name.take(255), type, bytes)
}

private fun sha256(bytes: ByteArray): String {
    val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
    return digest.joinToString("") { "%02x".format(it) }
}

@Composable
private fun eyebrow() = with(LocalPersonalTheme.current) { if (isDark) palette.popoverBorder else palette.textPrimary }

@Composable
private fun Gold(label: String, enabled: Boolean, onClick: () -> Unit) {
    val theme = LocalPersonalTheme.current
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(48.dp)
            .clip(RoundedCornerShape(PersonalRadius.action))
            .background(if (enabled) theme.action.default else theme.palette.border)
            .then(if (enabled) Modifier.clickable(onClick = onClick) else Modifier),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = if (enabled) theme.action.label else theme.palette.textSecondary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 15.sp)
    }
}

@Composable
private fun Outlined(label: String, onClick: () -> Unit) {
    val theme = LocalPersonalTheme.current
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(48.dp)
            .clip(RoundedCornerShape(PersonalRadius.action))
            .border(1.dp, theme.palette.border, RoundedCornerShape(PersonalRadius.action))
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = theme.palette.textPrimary, fontFamily = theme.fontFamily, fontWeight = FontWeight.Bold, fontSize = 15.sp)
    }
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
