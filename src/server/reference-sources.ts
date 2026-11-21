// Explicit, already-shared source references may point to Emme's historical
// messages. Ordinary evidence retrieval deliberately keeps workspace_source's
// human/external-source boundary: citing model output must not feed it back as
// independent evidence or silently adopt it.
export const referenceSourceRelation = `(
 SELECT * FROM workspace_source
 UNION ALL
 SELECT m.id,m.workspace_id,m.content,m.author_id,coalesce(m.assistant_display_name,'Emme') || ' AI' AS author_name,
 m.sequence,m.created_at,'message'::text AS kind,NULL::text AS title,NULL::text AS url,
 CASE WHEN m.purpose='followup_reminder' THEN 'Promemoria programmato da una persona e pubblicato automaticamente alla scadenza.'
 ELSE 'Contenuto generato da '||coalesce(m.assistant_display_name,'Emme')||'; non verificato indipendentemente, non informazione accettata né autorizzazione.' END AS qualification,
 NULL::uuid AS document_id,NULL::integer AS document_version,NULL::text AS content_hash
 FROM message m WHERE m.actor_kind='miriam'
)`;
