package it.miriam.nativeapp
import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.unit.dp
import org.json.JSONObject
@Composable fun ArtifactBody(state:UiState,model:WorkspaceModel,version:JSONObject){
    ReferenceLink(ConversationReference("artifact",version.getString("artifact_id"),version.getInt("version")))
    val blocks=version.optJSONArray("blocks")
    if(blocks==null||blocks.length()==0)Text(version.getString("body")) else repeat(blocks.length()){index->val b=blocks.getJSONObject(index);when(b.getString("type")){
        "paragraph"->Text(b.getString("text"));"heading"->Text(b.getString("text"),style=MaterialTheme.typography.titleMedium)
        "checklist"->{val items=b.getJSONArray("items");repeat(items.length()){i->val item=items.getJSONObject(i);Text((if(item.getBoolean("checked"))"☑ " else "☐ ")+item.getString("text"))}}
        "table"->Column(Modifier.horizontalScroll(rememberScrollState())){val columns=b.getJSONArray("columns");Row{repeat(columns.length()){Text(columns.getString(it),Modifier.width(140.dp),style=MaterialTheme.typography.titleSmall)}};val rows=b.getJSONArray("rows");repeat(rows.length()){r->Row{val row=rows.getJSONArray(r);repeat(row.length()){Text(row.getString(it),Modifier.width(140.dp))}}}}
        "image"->{val id=b.getString("sourceId");var image by remember(id){mutableStateOf<ImageBitmap?>(null)};LaunchedEffect(id){image=model.sourceBytes(id)?.let{BitmapFactory.decodeByteArray(it,0,it.size)?.asImageBitmap()}};image?.let{Image(it,b.getString("alt"),Modifier.fillMaxWidth())};if(b.optString("caption").isNotEmpty())Text(b.getString("caption"),style=MaterialTheme.typography.bodySmall);SourceReference(state,model,id)}
    }}
}
