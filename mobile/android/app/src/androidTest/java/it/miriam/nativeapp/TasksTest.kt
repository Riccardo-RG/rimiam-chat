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

class TasksTest {
    @get:Rule val compose=createAndroidComposeRule<MainActivity>()
    private fun scroll(tag:String){
        if(tag in listOf("message","send")) return
        if(tag.endsWith("-open")){compose.onNodeWithTag("tools-open").performClick();return}
        compose.onNodeWithTag("content").performScrollToNode(hasTestTag(tag))
    }
    @Test fun tasksUIAcceptanceAndActivityRecovery(){
        compose.waitUntil(10000){compose.onAllNodesWithTag("email").fetchSemanticsNodes().isNotEmpty()||compose.onAllNodesWithTag("logout").fetchSemanticsNodes().isNotEmpty()}
        if(compose.onAllNodesWithTag("logout").fetchSemanticsNodes().isNotEmpty())compose.onNodeWithTag("logout").performClick()
        compose.waitUntil(10000){compose.onAllNodesWithTag("email").fetchSemanticsNodes().isNotEmpty()}
        scroll("server");compose.onNodeWithTag("server").performTextReplacement("http://10.0.2.2:3102")
        scroll("email");compose.onNodeWithTag("email").performTextInput("native-android@example.test")
        scroll("password");compose.onNodeWithTag("password").performTextInput("Native-test-only-2026!")
        scroll("login");compose.onNodeWithTag("login").performClick()
        compose.enterWorkspace()
        scroll("tasks-open");compose.onNodeWithTag("tasks-open").performClick()
        compose.waitUntil(10000){compose.onAllNodesWithTag("task-title").fetchSemanticsNodes().isNotEmpty()}
        val title="Compose Tasks ${UUID.randomUUID()}"
        compose.onNodeWithTag("task-title").performTextInput(title)
        compose.onNodeWithTag("task-save").performScrollTo().performClick()
        val c=Vault(InstrumentationRegistry.getInstrumentation().targetContext).load().credential!!;val api=Api(c.base)
        val w=runBlocking{api.call("workspaces",c.token).rows("workspaces").first().getString("id")}
        var task:JSONObject?=null
        compose.waitUntil(10000){task=runBlocking{api.call("workspaces/$w/tasks",c.token).rows("tasks").find{it.getString("title")==title}};task!=null}
        assertTrue(task!!.isNull("responsible"));val id=task!!.getString("id")
        compose.waitUntil(10000){compose.onAllNodesWithTag("task-accept-$id").fetchSemanticsNodes().isNotEmpty()}
        compose.onNodeWithTag("task-accept-$id").performScrollTo().performClick()
        compose.waitUntil(10000){runBlocking{api.call("workspaces/$w/tasks",c.token).rows("tasks").first{it.getString("id")==id}.optString("responsible")!="null"}}
        compose.activityRule.scenario.recreate()
        compose.enterWorkspace()
        scroll("tasks-open");compose.onNodeWithTag("tasks-open").performClick()
        compose.waitUntil(10000){compose.onAllNodesWithText(title).fetchSemanticsNodes().isNotEmpty()}
        val persisted=runBlocking{api.call("workspaces/$w/tasks",c.token).rows("tasks").first{it.getString("id")==id}}
        assertFalse(persisted.isNull("responsible"));assertEquals(1,persisted.getInt("acceptedVersion"))
    }
}
