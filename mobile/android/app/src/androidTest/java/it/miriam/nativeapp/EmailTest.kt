package it.miriam.nativeapp

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import org.junit.Rule
import org.junit.Test
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import java.util.UUID

class EmailTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private fun scroll(tag: String) {
        if(tag in listOf("message","send")) return
        if(tag.endsWith("-open")) {compose.onNodeWithTag("tools-open").performClick();return}
        compose.onNodeWithTag("content").performScrollToNode(hasTestTag(tag))
    }
    @Test fun nativeEmailDraftProposalUnknownAndReconciliation() {
        // Preserve the real shared-IP sign-in limiter across the full suite.
        Thread.sleep(10100)
        compose.waitUntil(10000) { compose.onAllNodesWithTag("email").fetchSemanticsNodes().isNotEmpty() || compose.onAllNodesWithTag("logout").fetchSemanticsNodes().isNotEmpty() }
        if (compose.onAllNodesWithTag("logout").fetchSemanticsNodes().isNotEmpty()) compose.onNodeWithTag("logout").performClick()
        compose.waitUntil(10000) { compose.onAllNodesWithTag("email").fetchSemanticsNodes().isNotEmpty() }
        scroll("server"); compose.onNodeWithTag("server").performTextReplacement("http://10.0.2.2:3102")
        scroll("email"); compose.onNodeWithTag("email").performTextInput("native-android@example.test")
        scroll("password"); compose.onNodeWithTag("password").performTextInput("Native-test-only-2026!")
        scroll("login"); compose.onNodeWithTag("login").performClick()
        compose.enterWorkspace()
        scroll("email-open"); compose.onNodeWithTag("email-open").performClick()
        compose.waitUntil(10000) { compose.onAllNodesWithTag("email-to").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Usa mailbox: native-android@example.test").performScrollTo().performClick()
        val title = "Compose Email ${UUID.randomUUID()} [response-loss]"
        compose.onNodeWithTag("email-to").performScrollTo().performTextInput("guest@example.test,other@example.test")
        compose.onNodeWithTag("email-subject").performScrollTo().performTextInput(title)
        compose.onNodeWithTag("email-body").performScrollTo().performTextInput("Solo contenuto approvato")
        compose.onNodeWithTag("email-reason").performScrollTo().performTextInput("Invio personale di test")
        compose.onNodeWithTag("email-save").performScrollTo().performClick()
        compose.waitUntil(10000) { compose.onAllNodesWithText("$title · v1").fetchSemanticsNodes().isNotEmpty() }
        val credential=Vault(InstrumentationRegistry.getInstrumentation().targetContext).load().credential!!
        val api=Api(credential.base)
        val workspace=runBlocking { api.call("workspaces",credential.token).rows("workspaces").first().getString("id") }
        val draft=runBlocking { api.call("workspaces/$workspace/email",credential.token).rows("drafts").first{it.getJSONObject("envelope").getString("subject")==title}.getString("id") }
        compose.onNodeWithTag("email-propose-$draft").performScrollTo().performClick()
        compose.waitUntil(10000) { compose.onAllNodesWithText("Autorizzo invio e disclosure per me").fetchSemanticsNodes().isNotEmpty() }
        val action=runBlocking { api.call("workspaces/$workspace/email",credential.token).rows("actions").first{it.getString("draftId")==draft}.getString("id") }
        compose.onNodeWithTag("email.authorize-$action").performScrollTo().performClick()
        compose.waitUntil(15000) { compose.onAllNodes(hasTestTag("email-status-$action") and hasText("$title · OUTCOME_UNKNOWN · v1")).fetchSemanticsNodes().isNotEmpty() }
        // Activity recreation retains credentials/journal, but re-fetches private read state.
        compose.activityRule.scenario.recreate()
        compose.enterWorkspace()
        scroll("email-open");compose.onNodeWithTag("email-open").performClick()
        compose.waitUntil(10000) { compose.onAllNodesWithTag("email.reconcile-$action").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("email.reconcile-$action").performScrollTo().performClick()
        compose.waitUntil(15000) { compose.onAllNodes(hasTestTag("email-status-$action") and hasText("$title · SUCCEEDED · v1")).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Indietro").performClick()
        compose.onNodeWithTag("logout").performClick()
        compose.waitUntil(10000) { compose.onAllNodesWithTag("email").fetchSemanticsNodes().isNotEmpty() }
    }
}
