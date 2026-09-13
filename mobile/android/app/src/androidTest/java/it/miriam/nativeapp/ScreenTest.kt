package it.miriam.nativeapp

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.Lifecycle
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Rule
import org.junit.Test
import java.util.UUID

class ScreenTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private fun scroll(tag: String) {
        if(tag in listOf("message","send")) return
        if(tag.endsWith("-open")) {compose.onNodeWithTag("tools-open").performClick();return}
        compose.onNodeWithTag("content").performScrollToNode(hasTestTag(tag))
    }
    @Test fun loginSendBackgroundCatchUpLogout() {
        compose.waitUntil(10000) { compose.onAllNodesWithTag("email").fetchSemanticsNodes().isNotEmpty() }
        scroll("server"); compose.onNodeWithTag("server").performTextReplacement("http://10.0.2.2:3102")
        scroll("email"); compose.onNodeWithTag("email").performTextInput("native-android@example.test")
        scroll("password"); compose.onNodeWithTag("password").performTextInput("Native-test-only-2026!")
        scroll("login"); compose.onNodeWithTag("login").performClick()
        compose.enterWorkspace()
        val text = "Compose UI ${UUID.randomUUID()}"
        scroll("message"); compose.onNodeWithTag("message").performTextInput(text)
        scroll("send"); compose.onNodeWithTag("send").performClick()
        compose.waitUntil(10000) { compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty() }
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val credential = Vault(context).load().credential!!
        val background = "Android resume ${UUID.randomUUID()}"
        compose.activityRule.scenario.moveToState(Lifecycle.State.CREATED)
        runBlocking {
            val api = Api(credential.base)
            val w = api.call("workspaces", credential.token).rows("workspaces").first().getString("id")
            api.call("workspaces/$w/commands", credential.token, "POST", JSONObject().put("commandId", UUID.randomUUID().toString()).put("command", JSONObject().put("type", "message.send").put("content", background)))
        }
        compose.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
        compose.waitUntil(10000) {
            try { scroll("send"); compose.onAllNodesWithText(background).fetchSemanticsNodes().isNotEmpty() } catch (_: AssertionError) { false }
        }
        compose.onNodeWithText("Home").performClick()
        compose.onNodeWithTag("logout").performClick()
        compose.waitUntil(10000) { compose.onAllNodesWithTag("email").fetchSemanticsNodes().isNotEmpty() }
    }
}
