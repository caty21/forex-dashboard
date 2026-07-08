' Lance le dashboard Forex en PWA : demarre "npm run dev" si besoin (silencieux,
' attend que le serveur reponde), puis ouvre l'app Chrome installee.
' Cible ce script depuis le raccourci Bureau / Menu Demarrer a la place de
' chrome_proxy.exe directement, pour ne plus tomber sur une page blanche
' quand le serveur de dev n'est pas deja lance.

projectDir = "C:\Users\capug\Documents\Private\Investissements\Trading\Code\forex-dashboard"
logDir     = projectDir & "\logs"
serverUrl  = "http://localhost:3000/"
chromeExe  = "C:\Program Files\Google\Chrome\Application\chrome_proxy.exe"
chromeArgs = " --profile-directory=""Profile 4"" --app-id=hbblfifohofgngfbjbiimbbcimepbdcb"
maxWaitSec = 30

Set fso      = CreateObject("Scripting.FileSystemObject")
Set WshShell = CreateObject("WScript.Shell")

If Not fso.FolderExists(logDir) Then fso.CreateFolder(logDir)

Function IsServerUp(url)
  On Error Resume Next
  Dim http
  IsServerUp = False
  Set http = CreateObject("MSXML2.XMLHTTP")
  http.Open "GET", url, False
  http.Send
  If Err.Number = 0 And http.Status >= 200 And http.Status < 500 Then
    IsServerUp = True
  End If
  Err.Clear
  On Error Goto 0
End Function

If Not IsServerUp(serverUrl) Then
  WshShell.CurrentDirectory = projectDir
  cmd = "cmd /c npm run dev >> """ & logDir & "\dashboard.log"" 2>&1"
  WshShell.Run cmd, 0, False

  waited = 0
  Do While waited < maxWaitSec
    WScript.Sleep 1000
    waited = waited + 1
    If IsServerUp(serverUrl) Then Exit Do
  Loop
End If

WshShell.Run """" & chromeExe & """" & chromeArgs, 1, False
