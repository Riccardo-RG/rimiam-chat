package it.miriam.nativeapp
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.AndroidComposeTestRule
import androidx.test.ext.junit.rules.ActivityScenarioRule
fun AndroidComposeTestRule<ActivityScenarioRule<MainActivity>, MainActivity>.enterWorkspace() {
    waitUntil(15000){onAllNodesWithText("Workspace android di verifica").fetchSemanticsNodes().isNotEmpty()}
    onNodeWithTag("content").performScrollToNode(hasText("Workspace android di verifica"))
    onNodeWithText("Workspace android di verifica").performClick()
    waitUntil(10000){onAllNodesWithTag("tools-open").fetchSemanticsNodes().isNotEmpty()}
}
