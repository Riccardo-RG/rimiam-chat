package it.miriam.nativeapp

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import org.junit.Rule
import org.junit.Test
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import java.util.UUID
import org.junit.Assert.*

class ActiveWorkTest {
    @get:Rule val compose=createAndroidComposeRule<MainActivity>()
    private fun scroll(tag:String){
        if(tag in listOf("message","send")) return
        if(tag.startsWith("active-work-")) {
            if(compose.onAllNodesWithTag("lens-close").fetchSemanticsNodes().isEmpty())compose.onNodeWithTag("tools-open").performClick()
            if(compose.onAllNodesWithTag("work-open").fetchSemanticsNodes().isNotEmpty())compose.onNodeWithTag("work-open").performScrollTo().performClick()
            compose.onNodeWithTag(tag).performScrollTo()
            return
        }
        if(tag.endsWith("-open")){compose.onNodeWithTag("tools-open").performClick();return}
        compose.onNodeWithTag("content").performScrollToNode(hasTestTag(tag))
    }
    @Test fun activeWorkControlAndActivityRecovery(){
        compose.waitUntil(10000){compose.onAllNodesWithTag("email").fetchSemanticsNodes().isNotEmpty()||compose.onAllNodesWithTag("logout").fetchSemanticsNodes().isNotEmpty()}
        if(compose.onAllNodesWithTag("logout").fetchSemanticsNodes().isNotEmpty())compose.onNodeWithTag("logout").performClick()
        compose.waitUntil(10000){compose.onAllNodesWithTag("email").fetchSemanticsNodes().isNotEmpty()}
        scroll("server");compose.onNodeWithTag("server").performTextReplacement("http://10.0.2.2:3102")
        scroll("email");compose.onNodeWithTag("email").performTextInput("native-android@example.test")
        scroll("password");compose.onNodeWithTag("password").performTextInput("Native-test-only-2026!")
        scroll("login");compose.onNodeWithTag("login").performClick()
        compose.enterWorkspace()
        val c=Vault(InstrumentationRegistry.getInstrumentation().targetContext).load().credential!!; val api=Api(c.base)
        val w=runBlocking{api.call("workspaces",c.token).rows("workspaces").first{it.getString("name")=="Workspace android di verifica"}.getString("id")}
        fun command(body:JSONObject) = runBlocking { api.call("workspaces/$w/commands",c.token,"POST",JSONObject().put("commandId",UUID.randomUUID().toString()).put("expectedActorId",c.user.id).put("command",body)) }
        val topic="MilanoCompose${UUID.randomUUID().toString().take(8)}"
        command(JSONObject().put("type","message.send").put("content","Il locale $topic costa 3000 euro al mese, dato da verificare."))
        scroll("message");compose.onNodeWithTag("message").performTextInput("Analizza: $topic")
        scroll("send");compose.onNodeWithTag("send").performClick()
        var work:JSONObject?=null
        fun current():JSONObject? = runBlocking { api.call("workspaces/$w/active-work",c.token).rows("works").firstOrNull { it.getJSONObject("contract").getString("objective")==topic } }
        compose.waitUntil(15000){work=current();work?.optString("phase")=="completed"}
        val id=work!!.getString("id");assertFalse(work!!.isNull("contribution"))
        compose.waitUntil(10000){runCatching { scroll("active-work-$id") }.isSuccess};compose.onNodeWithText(topic).performClick()
        compose.onNodeWithTag("work-pause").performScrollTo().performClick()
        compose.waitUntil(10000){current()?.optString("phase")=="paused"}
        compose.waitUntil(10000){runCatching { compose.onNode(hasText("In pausa") and hasAnyAncestor(hasTestTag("active-work-$id"))).assertExists() }.isSuccess}
        compose.onNodeWithText("Aggiungi informazioni").performScrollTo().performClick()
        compose.onNodeWithText("Segnala un’obiezione").performClick()
        compose.onNodeWithTag("work-instruction").performScrollTo().performTextInput("chiarire i costi")
        compose.activityRule.scenario.onActivity { activity -> (activity.getSystemService(android.content.Context.INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager).hideSoftInputFromWindow(activity.currentFocus?.windowToken,0) }
        compose.onNodeWithText("Invia istruzione").performScrollTo().performClick()
        compose.waitUntil(10000){current()?.optString("phase")=="needs_input"}
        compose.onNodeWithTag("work-resume").assertIsNotEnabled()
        compose.activityRule.scenario.recreate()
        compose.waitUntil(10000){compose.onAllNodesWithTag("logout").fetchSemanticsNodes().isNotEmpty()}
        compose.enterWorkspace()
        compose.waitUntil(10000){runCatching { scroll("active-work-$id") }.isSuccess};compose.onNodeWithText(topic).performClick()
        compose.onNodeWithText("chiarire i costi").assertExists()
        compose.onNodeWithText("Ritira la tua richiesta").performScrollTo().performClick()
        compose.waitUntil(10000){current()?.rows("issues")?.isEmpty()==true}
        compose.waitUntil(10000){runCatching { compose.onNodeWithTag("work-resume").assertIsEnabled() }.isSuccess}
        compose.onNodeWithTag("work-resume").performScrollTo().performClick()
        compose.waitUntil(15000){current()?.optString("phase")=="completed"}
        compose.waitUntil(10000){runCatching { compose.onNode(hasText("Completato",substring=true) and hasAnyAncestor(hasTestTag("active-work-$id"))).assertExists() }.isSuccess}
        compose.onNodeWithTag("work-stop").performScrollTo().performClick()
        compose.waitUntil(10000){current()?.optString("phase")=="stopped"}
        assertTrue(runBlocking { api.call("workspaces/$w/active-work-history?id=$id",c.token) }.getJSONArray("contributions").length()>=1)
        compose.activityRule.scenario.recreate()
        compose.waitUntil(10000){compose.onAllNodesWithTag("logout").fetchSemanticsNodes().isNotEmpty()}
        compose.enterWorkspace()
        compose.waitUntil(10000){runCatching { scroll("active-work-$id") }.isSuccess};compose.waitUntil(10000){runCatching { compose.onNode(hasText("Fermato") and hasAnyAncestor(hasTestTag("active-work-$id"))).assertExists() }.isSuccess}
    }
}
