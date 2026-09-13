package it.miriam.nativeapp

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import org.junit.Rule
import org.junit.Test
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.UUID

class CalendarTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private fun scroll(tag: String) {
        if(tag in listOf("message","send")) return
        if(tag.endsWith("-open")) {compose.onNodeWithTag("tools-open").performClick();return}
        compose.onNodeWithTag("content").performScrollToNode(hasTestTag(tag))
    }
    @Test fun nativeCalendarProposalApprovalUnknownAndReconciliation() {
        compose.waitUntil(10000) { compose.onAllNodesWithTag("email").fetchSemanticsNodes().isNotEmpty() || compose.onAllNodesWithTag("logout").fetchSemanticsNodes().isNotEmpty() }
        if (compose.onAllNodesWithTag("logout").fetchSemanticsNodes().isNotEmpty()) compose.onNodeWithTag("logout").performClick()
        compose.waitUntil(10000) { compose.onAllNodesWithTag("email").fetchSemanticsNodes().isNotEmpty() }
        scroll("server"); compose.onNodeWithTag("server").performTextReplacement("http://10.0.2.2:3102")
        scroll("email"); compose.onNodeWithTag("email").performTextInput("native-android@example.test")
        scroll("password"); compose.onNodeWithTag("password").performTextInput("Native-test-only-2026!")
        scroll("login"); compose.onNodeWithTag("login").performClick()
        compose.enterWorkspace()
        scroll("calendar-open"); compose.onNodeWithTag("calendar-open").performClick()
        compose.waitUntil(10000) { compose.onAllNodesWithTag("calendar-title").fetchSemanticsNodes().isNotEmpty() }
        val title = "Compose Calendar ${UUID.randomUUID()} [response-loss]"
        compose.onNodeWithTag("calendar-title").performScrollTo().performTextInput(title)
        compose.onNodeWithTag("calendar-reason").performScrollTo().performTextInput("Appuntamento personale di test")
        compose.onNodeWithTag("calendar-self").performScrollTo().performClick()
        compose.onNodeWithTag("calendar-save").performScrollTo().performClick()
        compose.waitUntil(10000) { compose.onAllNodesWithText(title).fetchSemanticsNodes().isNotEmpty() }
        val publish = compose.onAllNodesWithText("Proponi pubblicazione su Calendario personale di test").onLast()
        publish.performScrollTo().performClick()
        compose.waitUntil(10000) { compose.onAllNodesWithText("Autorizzo questa azione per me").fetchSemanticsNodes().isNotEmpty() }
        val credential = Vault(InstrumentationRegistry.getInstrumentation().targetContext).load().credential!!
        val actionId = runBlocking {
            val api = Api(credential.base)
            val workspace = api.call("workspaces", credential.token).rows("workspaces").first().getString("id")
            val start = LocalDate.now().atStartOfDay(ZoneOffset.UTC).toInstant()
            api.call("workspaces/$workspace/calendar?start=$start&end=${start.plusSeconds(30*86400)}", credential.token).rows("actions").first { it.getJSONObject("payload").getString("title") == title }.getString("id")
        }
        compose.onNodeWithTag("calendar.authorize-$actionId").performScrollTo().performClick()
        compose.waitUntil(15000) { compose.onAllNodesWithText("OUTCOME_UNKNOWN · v1").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("calendar.reconcile-$actionId").performScrollTo().performClick()
        compose.waitUntil(15000) { compose.onAllNodes(hasTestTag("calendar-status-$actionId") and hasText("SUCCEEDED · v1")).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Indietro").performClick()
        compose.onNodeWithTag("logout").performClick()
        compose.waitUntil(10000) { compose.onAllNodesWithTag("email").fetchSemanticsNodes().isNotEmpty() }
    }
}
