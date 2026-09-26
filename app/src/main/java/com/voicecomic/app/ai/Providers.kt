package com.voicecomic.app.ai

import android.content.Context
import com.voicecomic.app.data.Settings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
data class ModelDef(
    val id: String,
    val free: Boolean = false,
    val nokey: Boolean = false,
    val label: String = "",
    val paid: Boolean = false
)

data class Provider(
    val id: String,
    val name: String,
    val key: Boolean = true,
    val openai: Boolean = true,
    val anthropic: Boolean = false,
    val gemini: Boolean = false,
    val endpoint: String = "",
    val vision: Boolean = false,
    val orchestrator: Boolean = false,
    val curated: Boolean = false,
    val models: List<ModelDef> = emptyList()
) {
    fun hasVision(): Boolean = vision
}

@Serializable
private data class DevModel(val id: String, val free: Int = 0, val label: String? = null)

@Serializable
private data class DevProvider(
    val name: String = "",
    val key: Boolean = true,
    val fmt: String = "openai",
    val endpoint: String = "",
    val vision: Boolean = false,
    val models: List<List<String>> = emptyList()
)

/** Каталог провайдеров: curated-таблица из ai.js + models.dev (как assets/models.dev.json). */
object Providers {

    private val ZEN_KEYLESS_CHAT = listOf(
        "big-pickle", "mimo-v2.5-free", "mimo-v2.6-flash-free", "nemotron-3-ultra-free",
        "nemotron-3.5-lightning-free", "ling-3.0-flash-fin-free", "space-bunny-free", "deepseek-v4-flash-free"
    )

    private val ZEN_KEYLESS_RESPONSES = listOf(
        "muse-spark-1.3-contributor-free", "muse-spark-1.2-contributor-free"
    )

    val ZEN_KEYLESS: List<String> = ZEN_KEYLESS_CHAT + ZEN_KEYLESS_RESPONSES

    fun m(id: String, free: Boolean = false, nokey: Boolean = false, label: String = ""): ModelDef =
        ModelDef(id, free, nokey, label.ifEmpty { id }, paid = !free && !nokey)

    private val CURATED: List<Provider> = listOf(
        Provider(
            id = "pollinations", name = "Pollinations · без ключа", key = false, vision = true,
            endpoint = "https://text.pollinations.ai/openai",
            models = listOf(m("openai", free = true), m("openai-fast", free = true), m("gpt-oss", free = true),
                m("gpt-oss-20b", free = true), m("ovh-reasoning", free = true))
        ),
        Provider(
            id = "openrouter", name = "OpenRouter · free/paid", vision = true, orchestrator = true,
            endpoint = "https://openrouter.ai/api/v1/chat/completions",
            models = listOf(
                m("meta-llama/llama-3.3-70b-instruct:free", free = true),
                m("google/gemma-3-27b-it:free", free = true),
                m("deepseek/deepseek-chat-v3-0324:free", free = true),
                m("qwen/qwen3-30b-a3b:free", free = true),
                m("anthropic/claude-sonnet-4.5"), m("anthropic/claude-3.7-sonnet"),
                m("openai/gpt-5.2"), m("google/gemini-2.5-flash")
            )
        ),
        Provider(
            id = "opencode", name = "OpenCode Zen · реальный шлюз", vision = true, orchestrator = true,
            endpoint = "https://opencode.ai/zen/v1/chat/completions",
            models = ZEN_KEYLESS.map { m(it, nokey = true) } + listOf(
                m("gpt-5.4"), m("gpt-5.4-pro"), m("claude-sonnet-4-5"), m("claude-opus-4-5"),
                m("gemini-3.7-flash"), m("gemini-3.1-pro"), m("grok-4.7"), m("deepseek-v4-flash-vision-exp")
            )
        ),
        Provider(
            id = "openai", name = "OpenAI", endpoint = "https://api.openai.com/v1/chat/completions",
            models = listOf(m("gpt-5.2"), m("gpt-5.2-mini"), m("gpt-4.1"), m("gpt-4.1-mini"), m("o4-mini"), m("gpt-4o-mini"))
        ),
        Provider(
            id = "anthropic", name = "Anthropic Claude", openai = false, anthropic = true,
            endpoint = "https://api.anthropic.com/v1/messages",
            models = listOf(m("claude-sonnet-4-5"), m("claude-haiku-4-5"), m("claude-3-7-sonnet-20250219"), m("claude-3-5-haiku-20241024"))
        ),
        Provider(
            id = "gemini", name = "Google Gemini", openai = false, gemini = true,
            endpoint = "https://generativelanguage.googleapis.com/v1beta",
            models = listOf(m("gemini-2.5-flash"), m("gemini-2.5-pro"), m("gemini-2.0-flash"), m("gemini-1.5-flash"))
        ),
        Provider(
            id = "groq", name = "Groq (free tier)", endpoint = "https://api.groq.com/openai/v1/chat/completions",
            models = listOf(m("llama-3.3-70b-versatile", free = true), m("llama-3.1-8b-instant", free = true),
                m("gemma2-9b-it", free = true), m("qwen-qwq-32b", free = true))
        ),
        Provider(
            id = "deepseek", name = "DeepSeek", vision = true, endpoint = "https://api.deepseek.com/v1/chat/completions",
            models = listOf(m("deepseek-chat"), m("deepseek-reasoner"))
        ),
        Provider(
            id = "mistral", name = "Mistral AI", endpoint = "https://api.mistral.ai/v1/chat/completions",
            models = listOf(m("open-mistral-nemo"), m("mistral-small-latest"), m("mistral-large-latest"))
        ),
        Provider(
            id = "together", name = "Together AI", endpoint = "https://api.together.xyz/v1/chat/completions",
            models = listOf(m("meta-llama/Llama-3.3-70B-Instruct-Turbo"), m("deepseek-ai/DeepSeek-V3"))
        ),
        Provider(
            id = "xai", name = "xAI Grok", endpoint = "https://api.x.ai/v1/chat/completions",
            models = listOf(m("grok-3"), m("grok-3-mini"))
        ),
        Provider(
            id = "perplexity", name = "Perplexity", endpoint = "https://api.perplexity.ai/chat/completions",
            models = listOf(m("sonar-pro"), m("sonar"))
        ),
        Provider(
            id = "cerebras", name = "Cerebras", endpoint = "https://api.cerebras.ai/v1/chat/completions",
            models = listOf(m("llama-3.3-70b", free = true), m("llama-3.1-8b-instant", free = true))
        ),
        Provider(id = "custom", name = "Свой OpenAI-совместимый API", models = emptyList()),
        Provider(
            id = "local", name = "Local (Ollama / OpenWebUI)", endpoint = "http://localhost:11434/api/chat",
            models = listOf(m("llama3.1:8b", free = true), m("mistral:7b", free = true), m("phi3:medium", free = true), m("gemma2:9b", free = true))
        )
    )

    val KEY_URLS = mapOf(
        "openai" to "https://platform.openai.com/api-keys",
        "anthropic" to "https://console.anthropic.com/settings/keys",
        "gemini" to "https://aistudio.google.com/app/apikey",
        "openrouter" to "https://openrouter.ai/settings/keys",
        "opencode" to "https://opencode.ai/zen",
        "groq" to "https://console.groq.com/keys",
        "deepseek" to "https://platform.deepseek.com/api_keys",
        "mistral" to "https://console.mistral.ai/api-keys",
        "together" to "https://api.together.ai/settings/api-keys",
        "xai" to "https://console.x.ai/",
        "perplexity" to "https://www.perplexity.ai/settings/api",
        "cerebras" to "https://console.cerebras.ai/api-keys"
    )

    private val json = Json { ignoreUnknownKeys = true; isLenient = true }

    @Volatile
    private var devProviders: Map<String, DevProvider>? = null

    suspend fun loadDevCatalog(context: Context) = withContext(Dispatchers.IO) {
        if (devProviders != null) return@withContext
        runCatching {
            val txt = context.assets.open("models.dev.json").bufferedReader().use { it.readText() }
            val map = LinkedHashMap<String, DevProvider>()
            for ((pid, p) in json.parseToJsonElement(txt).let { el ->
                val obj = el as kotlinx.serialization.json.JsonObject
                obj.mapValues { (_, v) -> json.decodeFromJsonElement(DevProvider.serializer(), v) }
            }) {
                map[pid] = p
            }
            devProviders = map
        }
    }

    /** Слияние как в ai.js: сначала curated, потом models.dev (пустой endpoint пропускается). */
    fun catalog(): List<Provider> {
        val out = LinkedHashMap<String, Provider>()
        for (p in CURATED) out[p.id] = p.copy(curated = true)
        for ((pid, d) in (devProviders ?: emptyMap<String, DevProvider>())) {
            val models = d.models.mapNotNull { row ->
                val id = row.getOrNull(0) ?: return@mapNotNull null
                m(id, free = row.getOrNull(1) == "1", label = row.getOrNull(2) ?: id)
            }
            val existing = out[pid]
            if (existing != null) {
                val merged = (existing.models + models.filter { nm -> existing.models.none { it.id == nm.id } })
                out[pid] = existing.copy(models = merged, vision = existing.vision || d.vision)
            } else if (d.endpoint.isNotEmpty()) {
                out[pid] = Provider(
                    id = pid, name = d.name, key = d.key, openai = d.fmt != "anthropic",
                    anthropic = d.fmt == "anthropic", endpoint = d.endpoint, vision = d.vision, models = models
                )
            }
        }
        return out.values.toList()
    }

    fun provider(id: String): Provider =
        catalog().firstOrNull { it.id == id } ?: catalog().first { it.id == "custom" }

    fun keyUrl(p: Provider): String = KEY_URLS[p.id]
        ?: runCatching { p.endpoint.substringBefore("/v1").substringBefore("/api").trimEnd('/') + "/" }.getOrDefault("")

    // ---------- фильтры пикера моделей ----------

    private val DUMB_KEYS = Regex(
        "mini|lite|light|small|tiny|fast|flash|haiku|instant|nano|micro|pico|sprint|cheap|quick|compact|pixel|\\b0\\.\\db\\b|1\\.5b|2b|3b|7b|8b|9b|12b|20b|27b|32b|gpt-oss-20b"
    )
    private val SMART_KEYS = Regex(
        "reason|rational|thinking|thinker|opus|sonnet|pro\$|ultra|max\$|flash-thinking|r1|r2|qwq|\\bo[1-9]\\b|grok-3|grok-4|deepseek-v4|deepseek-r1|deepseek-chat|glm-5|kimi-k3|qwen3-(235|430|max)|premium|200b|400b|1\\.5-trillion|trillion"
    )
    private val REASONING_MODELS = Regex("^(o[1-9]\\d*(\\.\\d+)?(-|$)|gpt-5|codex)", RegexOption.IGNORE_CASE)

    fun isSmartModel(label: String, id: String): Boolean {
        val s = (label + " " + id).lowercase()
        Regex("(\\d+(?:\\.\\d+)?)\\s*b\\b").find(s)?.let { m ->
            val v = m.groupValues[1].toDoubleOrNull() ?: 0.0
            return v >= 32
        }
        if (DUMB_KEYS.containsMatchIn(s)) return false
        if (SMART_KEYS.containsMatchIn(s)) return true
        return true
    }

    fun isReasoningModel(id: String): Boolean = REASONING_MODELS.containsMatchIn(id)

    data class Meta(
        val pid: String,
        val mid: String,
        val label: String,
        val providerName: String,
        val nokey: Boolean,
        val free: Boolean,
        val paid: Boolean,
        val vision: Boolean,
        val curated: Boolean,
        val requiresKey: Boolean,
        val smart: Boolean,
        val orchestrator: Boolean
    )

    fun meta(p: Provider, model: ModelDef): Meta {
        val kindFree = !p.key || model.free
        val nokey = !p.key || model.nokey
        return Meta(
            pid = p.id, mid = model.id, label = model.label.ifEmpty { model.id },
            providerName = p.name.substringBefore(" ·"), nokey = nokey, free = kindFree, paid = !kindFree,
            vision = p.vision, curated = p.curated, requiresKey = p.key,
            smart = isSmartModel(model.label.ifEmpty { model.id }, model.id), orchestrator = p.orchestrator
        )
    }

    fun flat(): List<Meta> = catalog().flatMap { p -> p.models.map { meta(p, it) } }

    fun rank(m: Meta): Int = when {
        m.curated && m.nokey -> 0
        m.curated && m.free -> 1
        m.curated && m.paid -> 2
        m.nokey -> 3
        m.free -> 4
        else -> 5
    }

    fun visionProviders(): List<Provider> = catalog().filter { it.vision && it.id != "custom" && it.id != "local" }

    fun modelsFor(settings: Settings): List<ModelDef> = provider(settings.ai).models

    fun isValidModel(settings: Settings): Boolean {
        val models = provider(settings.ai).models
        return models.isEmpty() || models.any { it.id == settings.aimodel }
    }
}
