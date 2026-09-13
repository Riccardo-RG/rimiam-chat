package it.miriam.nativeapp
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.delay
import org.json.JSONObject
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID
import android.util.Base64
@RunWith(AndroidJUnit4::class)
class WorkspaceSurfaceTest {
 @Test fun extendedProjectionAndUnadoptedStructuredDraftRemainScoped()=runBlocking {
  delay(10100)
  val api=Api("http://10.0.2.2:3102")
  val login=api.call("native/session",method="POST",body=JSONObject().put("email","native-android@example.test").put("password","Native-test-only-2026!"));val token=login.getString("token");val actor=login.getJSONObject("user").getString("id");val w=UUID.randomUUID().toString()
  api.call("workspaces",token,"POST",JSONObject().put("commandId",w).put("expectedActorId",actor).put("name","Native surfaces Android $w"))
  suspend fun command(value:JSONObject){api.call("workspaces/$w/commands",token,"POST",JSONObject().put("commandId",UUID.randomUUID().toString()).put("expectedActorId",actor).put("command",value))}
  command(JSONObject().put("type","goal.establish").put("content","Preparare insieme il locale"))
  val original="Preventivo attribuito: affitto da verificare".toByteArray()
  command(JSONObject().put("type","document.upload").put("filename","preventivo.txt").put("bytesBase64",Base64.encodeToString(original,Base64.NO_WRAP)))
  var detail=api.call("workspaces/$w/workspace",token);val source=detail.rows("sources").first()
  assertArrayEquals(original,api.bytes("workspaces/$w/source-file?id=${source.getString("id")}",token))
  command(JSONObject().put("type","artifact.compose").put("title","Brief Android").put("purpose","Valutare il locale").put("reason","Prima bozza personale").put("blocks",JSONArray().put(JSONObject().put("type","paragraph").put("text","Analisi da discutere"))).put("information",JSONArray()).put("sourceIds",JSONArray().put(source.getString("id"))).put("nonOperative",true))
  detail=api.call("workspaces/$w/workspace",token)
  assertEquals(1,detail.rows("artifactVersions").first().getJSONArray("blocks").length());assertTrue(detail.rows("artifacts").first().isNull("current_adoption_id"));assertTrue(detail.rows("versions").isEmpty())
  assertEquals(1,api.call("workspaces/$w/project",token).rows("goals").size);assertEquals(1,api.call("workspaces/$w/access",token).rows("relationships").size);assertTrue(api.call("workspaces/$w/attention",token).getInt("revision")>0)
  val other=api.call("native/session",method="POST",body=JSONObject().put("email","native-ios@example.test").put("password","Native-test-only-2026!"));val otherToken=other.getString("token")
  try{api.bytes("workspaces/$w/source-file?id=${source.getString("id")}",otherToken);fail("Source crossed Workspace boundary")}catch(e:ApiError){assertEquals(403,e.status)}
  api.call("native/session",token,"DELETE");api.call("native/session",otherToken,"DELETE")
 }
}
