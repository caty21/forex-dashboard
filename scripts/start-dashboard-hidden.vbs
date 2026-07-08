' Lance le dashboard Forex (npm run dev) en arriere-plan, sans fenetre visible.
' Copie de ce fichier dans le dossier Demarrage de Windows (shell:startup)
' pour un lancement automatique a chaque connexion.
projectDir = "C:\Users\capug\Documents\Private\Investissements\Trading\Code\forex-dashboard"
logDir = projectDir & "\logs"

Set fso = CreateObject("Scripting.FileSystemObject")
If Not fso.FolderExists(logDir) Then fso.CreateFolder(logDir)

Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = projectDir
cmd = "cmd /c npm run dev >> """ & logDir & "\dashboard.log"" 2>&1"
WshShell.Run cmd, 0, False
