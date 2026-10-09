package com.kudcrafts.kudmascot

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.Drawable
import android.os.Bundle
import android.util.Base64
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import org.xmlpull.v1.XmlPullParser
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL

const val DEFAULT_URL = "https://hammas-dev.tailaf13a.ts.net:4488"

private val Cream = Color(0xFFFEF8E8)
private val Ink = Color(0xFF2B2622)
private val Accent = Color(0xFFC4573A)

data class LauncherApp(
    val pkg: String,
    val activity: String,
    val label: String,
    val icon: Drawable,
    val preview: ImageBitmap,
) {
    val component get() = "$pkg/$activity"
}

/** What the phone shows per app. */
enum class Status(val text: String, val color: Color) {
    COVERED("covered", Color(0xFF3E7D5A)),
    UPDATE("in next update", Color(0xFF3E7D5A)),
    APPROVED("approved", Color(0xFF3E7D5A)),
    DRAFTED("drafted", Color(0xFFB07A1F)),
    REQUESTED("requested", Color(0xFF4F6D8F)),
    SKIPPED("skipped", Color(0xFF8A8072)),
    MISSING("missing", Accent),
}

class Prefs(ctx: Context) {
    private val p = ctx.getSharedPreferences("kudmascot", Context.MODE_PRIVATE)
    var url: String
        get() = p.getString("url", DEFAULT_URL) ?: DEFAULT_URL
        set(v) = p.edit().putString("url", v.trim().trimEnd('/')).apply()
    var token: String
        get() = p.getString("token", "") ?: ""
        set(v) = p.edit().putString("token", v.trim()).apply()
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme(
                colorScheme = lightColorScheme(
                    primary = Ink, onPrimary = Color.White, background = Cream, surface = Cream,
                    secondaryContainer = Color(0xFFF1D9A7),
                )
            ) { Screen() }
        }
    }
}

// ---------- data ----------

fun drawableToBitmap(d: Drawable, size: Int): Bitmap {
    val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val c = Canvas(bmp)
    val old = d.copyBounds()
    d.setBounds(0, 0, size, size)
    d.draw(c)
    d.bounds = old
    return bmp
}

fun pngBase64(d: Drawable, size: Int = 192): String {
    val out = ByteArrayOutputStream()
    drawableToBitmap(d, size).compress(Bitmap.CompressFormat.PNG, 100, out)
    return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
}

fun loadLauncherApps(ctx: Context): List<LauncherApp> {
    val pm = ctx.packageManager
    val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
    return pm.queryIntentActivities(intent, 0)
        .filter { it.activityInfo.packageName != ctx.packageName }
        .map {
            val icon = it.loadIcon(pm)
            LauncherApp(
                pkg = it.activityInfo.packageName,
                activity = it.activityInfo.name,
                label = it.loadLabel(pm).toString(),
                icon = icon,
                preview = drawableToBitmap(icon, 96).asImageBitmap(),
            )
        }
        .sortedBy { it.label.lowercase() }
}

/** Components this APK already themes, read from its own generated appfilter.xml. */
fun loadCovered(ctx: Context): Set<String> {
    val set = mutableSetOf<String>()
    val id = ctx.resources.getIdentifier("appfilter", "xml", ctx.packageName)
    if (id == 0) return set
    val p = ctx.resources.getXml(id)
    try {
        while (p.next() != XmlPullParser.END_DOCUMENT) {
            if (p.eventType == XmlPullParser.START_TAG && p.name == "item") {
                p.getAttributeValue(null, "component")
                    ?.removePrefix("ComponentInfo{")?.removeSuffix("}")
                    ?.let { set.add(it) }
            }
        }
    } finally {
        p.close()
    }
    return set
}

data class ServerStatus(val components: Map<String, String>, val packages: Map<String, String>)

fun http(prefs: Prefs, method: String, path: String, body: String? = null): String {
    val conn = URL(prefs.url + path).openConnection() as HttpURLConnection
    conn.requestMethod = method
    conn.connectTimeout = 10_000
    conn.readTimeout = 60_000
    conn.setRequestProperty("Authorization", "Bearer ${prefs.token}")
    if (body != null) {
        conn.doOutput = true
        conn.setRequestProperty("Content-Type", "application/json")
        conn.outputStream.use { it.write(body.toByteArray()) }
    }
    val code = conn.responseCode
    val text = (if (code in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
    conn.disconnect()
    if (code == 401) throw RuntimeException("Server refused the token (401). Check Settings.")
    if (code !in 200..299) throw RuntimeException("HTTP $code: ${text.take(200)}")
    return text
}

fun fetchStatus(prefs: Prefs): ServerStatus {
    val j = JSONObject(http(prefs, "GET", "/api/status"))
    fun map(o: JSONObject?): Map<String, String> =
        o?.keys()?.asSequence()?.associateWith { o.getString(it) } ?: emptyMap()
    return ServerStatus(map(j.optJSONObject("components")), map(j.optJSONObject("packages")))
}

fun postRequests(prefs: Prefs, apps: List<LauncherApp>): Int {
    var sent = 0
    // small batches: each carries a 192px PNG
    for (chunk in apps.chunked(10)) {
        val arr = JSONArray()
        for (a in chunk) {
            arr.put(JSONObject().put("package", a.pkg).put("activity", a.activity).put("label", a.label).put("icon", pngBase64(a.icon)))
        }
        http(prefs, "POST", "/api/requests", JSONObject().put("requests", arr).toString())
        sent += chunk.size
    }
    return sent
}

fun statusOf(app: LauncherApp, covered: Set<String>, server: ServerStatus?): Status {
    if (app.component in covered) return Status.COVERED
    val s = server?.components?.get(app.component) ?: return Status.MISSING
    return when (s) {
        "published" -> Status.UPDATE
        "approved" -> Status.APPROVED
        "drafted" -> Status.DRAFTED
        "skipped" -> Status.SKIPPED
        else -> Status.REQUESTED // requested, generating, failed
    }
}

fun applyInNova(ctx: Context): Boolean = try {
    ctx.startActivity(
        Intent("com.teslacoilsw.launcher.APPLY_ICON_THEME")
            .setPackage("com.teslacoilsw.launcher")
            .putExtra("com.teslacoilsw.launcher.extra.ICON_THEME_TYPE", "GO")
            .putExtra("com.teslacoilsw.launcher.extra.ICON_THEME_PACKAGE", ctx.packageName)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    )
    true
} catch (e: ActivityNotFoundException) {
    false
}

// ---------- UI ----------

enum class Filter(val text: String) { ALL("All"), MISSING("Missing"), PENDING("In progress"), COVERED("Covered") }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun Screen() {
    val ctx = LocalContext.current
    val prefs = remember { Prefs(ctx) }
    val scope = rememberCoroutineScope()
    val snack = remember { SnackbarHostState() }
    var apps by remember { mutableStateOf<List<LauncherApp>?>(null) }
    val covered = remember { loadCovered(ctx) }
    var server by remember { mutableStateOf<ServerStatus?>(null) }
    var serverError by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var filter by remember { mutableStateOf(Filter.ALL) }
    var showSettings by remember { mutableStateOf(prefs.token.isEmpty()) }

    fun refresh() {
        scope.launch {
            try {
                server = withContext(Dispatchers.IO) { fetchStatus(prefs) }
                serverError = null
            } catch (e: Exception) {
                serverError = e.message ?: e.toString()
            }
        }
    }

    fun request(list: List<LauncherApp>) {
        if (list.isEmpty()) return
        busy = true
        scope.launch {
            try {
                val n = withContext(Dispatchers.IO) { postRequests(prefs, list) }
                snack.showSnackbar("Requested $n app${if (n == 1) "" else "s"}")
                server = withContext(Dispatchers.IO) { fetchStatus(prefs) }
            } catch (e: Exception) {
                snack.showSnackbar(e.message ?: e.toString())
            } finally {
                busy = false
            }
        }
    }

    // One-shot load of the installed launcher activities and the server status.
    LaunchedEffect(Unit) {
        apps = withContext(Dispatchers.Default) { loadLauncherApps(ctx) }
        if (prefs.token.isNotEmpty()) refresh()
    }

    val list = apps
    val statuses = list?.associate { it.component to statusOf(it, covered, server) } ?: emptyMap()
    val missing = list?.filter { statuses[it.component] == Status.MISSING } ?: emptyList()

    Scaffold(
        containerColor = Cream,
        snackbarHost = { SnackbarHost(snack) },
        topBar = {
            TopAppBar(
                title = { Text("kudmascot") },
                actions = {
                    TextButton(onClick = { refresh() }) { Text("Refresh") }
                    TextButton(onClick = { showSettings = true }) { Text("Settings") }
                },
            )
        },
    ) { pad ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(pad),
            contentPadding = PaddingValues(bottom = 24.dp),
        ) {
            item {
                Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                    val counts = statuses.values.groupingBy { it }.eachCount()
                    Text(
                        "${counts[Status.COVERED] ?: 0} covered · ${missing.size} missing · " +
                            "${(counts[Status.REQUESTED] ?: 0) + (counts[Status.DRAFTED] ?: 0) + (counts[Status.APPROVED] ?: 0) + (counts[Status.UPDATE] ?: 0)} in progress",
                        fontSize = 14.sp,
                    )
                    if (serverError != null) {
                        Text("Server: $serverError", color = Accent, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
                    }
                    Spacer(Modifier.height(10.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = { request(missing) }, enabled = !busy && missing.isNotEmpty() && prefs.token.isNotEmpty()) {
                            Text(if (busy) "Sending…" else "Request all missing (${missing.size})")
                        }
                        OutlinedButton(onClick = {
                            if (!applyInNova(ctx)) scope.launch { snack.showSnackbar("Nova Launcher not found") }
                        }) { Text("Apply in Nova") }
                    }
                    Text(
                        "After an update, if icons don't refresh, re-apply the pack in Nova: Nova Settings → Look & feel → Icon style → Icon theme → kudmascot (or tap Apply in Nova).",
                        fontSize = 12.sp, color = Color(0xFF8A8072), modifier = Modifier.padding(top = 10.dp),
                    )
                    Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Filter.entries.forEach { f ->
                            FilterChip(selected = filter == f, onClick = { filter = f }, label = { Text(f.text) })
                        }
                    }
                }
                HorizontalDivider()
            }
            if (list == null) {
                item { Text("Loading apps…", Modifier.padding(16.dp)) }
            } else {
                val shown = list.filter {
                    val s = statuses[it.component]
                    when (filter) {
                        Filter.ALL -> true
                        Filter.MISSING -> s == Status.MISSING
                        Filter.COVERED -> s == Status.COVERED
                        Filter.PENDING -> s != Status.MISSING && s != Status.COVERED && s != Status.SKIPPED
                    }
                }
                items(shown, key = { it.component }) { app ->
                    AppRow(app, statuses[app.component] ?: Status.MISSING, enabled = !busy && prefs.token.isNotEmpty()) { request(listOf(app)) }
                }
            }
        }
    }

    if (showSettings) {
        ModalBottomSheet(onDismissRequest = { showSettings = false }, containerColor = Cream) {
            var url by remember { mutableStateOf(prefs.url) }
            var token by remember { mutableStateOf(prefs.token) }
            Column(Modifier.padding(horizontal = 20.dp).padding(bottom = 32.dp)) {
                Text("Server", fontSize = 18.sp)
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(url, { url = it }, label = { Text("Server URL") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(token, { token = it }, label = { Text("Token") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Text(
                    "Token: KUDMASCOT_TOKEN in ~/.config/kudmascot/env on hammas-dev. Default URL: $DEFAULT_URL",
                    fontSize = 12.sp, color = Color(0xFF8A8072), modifier = Modifier.padding(top = 6.dp),
                )
                Spacer(Modifier.height(12.dp))
                Button(onClick = {
                    prefs.url = url
                    prefs.token = token
                    showSettings = false
                    refresh()
                }, modifier = Modifier.fillMaxWidth()) { Text("Save") }
            }
        }
    }
}

@Composable
fun AppRow(app: LauncherApp, status: Status, enabled: Boolean, onRequest: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Image(app.preview, contentDescription = null, modifier = Modifier.size(40.dp))
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(app.label, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(app.component, fontSize = 11.sp, color = Color(0xFF8A8072), maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Spacer(Modifier.width(8.dp))
        if (status == Status.MISSING) {
            TextButton(onClick = onRequest, enabled = enabled) { Text("Request") }
        } else {
            Text(
                status.text,
                color = Color.White,
                fontSize = 11.sp,
                modifier = Modifier
                    .background(status.color, RoundedCornerShape(50))
                    .padding(horizontal = 8.dp, vertical = 3.dp),
            )
        }
    }
}
