package it.miriam.nativeapp

import android.app.*
import android.content.Intent
import android.os.IBinder

// Keeps an explicitly joined audio call alive. No incoming-call push or autonomous join.
class CallService:Service() {
    companion object {var leave:(()->Unit)?=null;const val CHANNEL="workspace-audio";const val ID=1501}
    override fun onBind(intent:Intent?):IBinder?=null
    override fun onCreate(){super.onCreate();getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(CHANNEL,"Chiamata Workspace",NotificationManager.IMPORTANCE_LOW))}
    override fun onStartCommand(intent:Intent?,flags:Int,startId:Int):Int {
        if(intent?.action=="leave"){leave?.invoke();stopSelf();return START_NOT_STICKY}
        val open=PendingIntent.getActivity(this,0,Intent(this,MainActivity::class.java),PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val end=PendingIntent.getService(this,1,Intent(this,CallService::class.java).setAction("leave"),PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        startForeground(ID,Notification.Builder(this,CHANNEL).setSmallIcon(android.R.drawable.stat_sys_phone_call).setContentTitle("Chiamata del Workspace").setContentText(intent?.getStringExtra("status")?:"Collegamento in corso").setContentIntent(open).setOngoing(true).addAction(Notification.Action.Builder(null,"Lascia",end).build()).build())
        return START_NOT_STICKY
    }
    override fun onTaskRemoved(rootIntent:Intent?){leave?.invoke();stopSelf()}
}
