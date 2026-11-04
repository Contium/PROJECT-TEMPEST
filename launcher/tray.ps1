# TEMPEST tray icon: lives in the Windows notification area while TEMPEST runs.
# Started hidden by launcher/tempest.js; exits at once if a tray is already running.
# Keep this file ASCII-only: Windows PowerShell 5.1 misreads UTF-8 without a BOM.
#
# Menu: Show GM window (also double-click) / Open player screen /
#       Restart server / Start with Windows / Quit TEMPEST
#
# Nothing on the menu's thread ever waits: a background worker polls the server
# into a shared table the menu reads instantly, and launcher commands run as
# separate processes that a timer checks on. (A blocked UI thread freezes the menu.)

param(
  [Parameter(Mandatory = $true)] [string]$Root,
  [Parameter(Mandatory = $true)] [string]$Node,
  [int]$Port = 4077,
  # Diagnostics: build the menu, wait for the first poll, time the menu's handlers,
  # print JSON and exit. Runs alongside a real tray (no icon, no single-instance lock).
  [switch]$SelfTest
)

$isFirst = $false
$mutex = $null
if (-not $SelfTest) {
  $mutex = New-Object System.Threading.Mutex($true, 'Local\TEMPEST.Tray', [ref]$isFirst)
  if (-not $isFirst) { return }
}

Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;

// Finds TEMPEST's app windows by title so the tray can focus or close them.
public static class TempestWindows {
  delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int max);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int cmd);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr w, IntPtr l);

  public static List<string> Titles(string pattern) {
    var titles = new List<string>();
    foreach (var h in Find(pattern)) titles.Add(TitleOf(h));
    return titles;
  }

  static string TitleOf(IntPtr h) {
    var sb = new StringBuilder(512);
    GetWindowText(h, sb, sb.Capacity);
    return sb.ToString();
  }

  public static List<IntPtr> Find(string pattern) {
    var re = new Regex(pattern);
    var found = new List<IntPtr>();
    EnumWindows((h, p) => {
      if (IsWindowVisible(h) && re.IsMatch(TitleOf(h))) found.Add(h);
      return true;
    }, IntPtr.Zero);
    return found;
  }

  public static bool Focus(string pattern) {
    var list = Find(pattern);
    if (list.Count == 0) return false;
    if (IsIconic(list[0])) ShowWindow(list[0], 9); // SW_RESTORE
    SetForegroundWindow(list[0]);
    return true;
  }

  public static int CloseAll(string pattern) {
    var list = Find(pattern);
    foreach (var h in list) PostMessage(h, 0x0010, IntPtr.Zero, IntPtr.Zero); // WM_CLOSE
    return list.Count;
  }
}
'@

# --- Settings ---------------------------------------------------------------------

$dot = [string][char]0x00B7
$GmPattern = '^TEMPEST( ' + $dot + ' .*)?$'           # "TEMPEST" or "TEMPEST . <section>"
$PlayerPattern = $dot + ' Player Screen$'             # "<view> . Player Screen"
$AnyPattern = '(' + $GmPattern + ')|(' + $PlayerPattern + ')'
$Api = "http://127.0.0.1:$Port/api"
$Launcher = Join-Path $Root 'launcher\tempest.js'
$DataDir = Join-Path $env:LOCALAPPDATA 'TEMPEST'
$QuitFlag = Join-Path $DataDir 'tray.quit'
$LogFile = Join-Path $DataDir 'logs\server.log'

function Write-TrayLog([string]$Message) {
  try { Add-Content -Path $LogFile -Value ("[{0}] [tray] {1}" -f (Get-Date).ToUniversalTime().ToString('o'), $Message) } catch { }
}

# --- Background worker: polls the server into $state -------------------------------

$state = [hashtable]::Synchronized(@{
  running = $false; version = ''; autostart = $null
  polledAt = [DateTime]::MinValue; refresh = $false; stop = $false
  requests = New-Object 'System.Collections.Concurrent.ConcurrentQueue[string]'
})

$worker = [PowerShell]::Create()
[void]$worker.AddScript({
  param($state, $api)
  # WebClient without proxy detection: Invoke-RestMethod can stall seconds on WPAD lookups.
  $get = {
    param($path)
    $c = New-Object System.Net.WebClient
    $c.Proxy = $null
    $c.Encoding = [System.Text.Encoding]::UTF8
    try { return ($c.DownloadString($api + $path) | ConvertFrom-Json) } finally { $c.Dispose() }
  }
  while (-not $state.stop) {
    $body = $null
    while ($state.requests.TryDequeue([ref]$body)) {
      try {
        $c = New-Object System.Net.WebClient
        $c.Proxy = $null
        $c.Headers['Content-Type'] = 'application/json'
        $state.autostart = $c.UploadString($api + '/system/autostart', 'POST', $body) | ConvertFrom-Json
        $c.Dispose()
      } catch { }
    }
    try {
      $health = & $get '/health'
      $state.running = ($health.app -eq 'tempest')
      $state.version = $health.version
    } catch { $state.running = $false }
    if ($state.running) {
      try { $state.autostart = & $get '/system/autostart' } catch { }
    }
    $state.polledAt = [DateTime]::UtcNow
    # Sleep ~3s, waking early for a refresh request, a queued change, or shutdown.
    for ($i = 0; $i -lt 30 -and -not $state.stop -and -not $state.refresh -and $state.requests.IsEmpty; $i++) { Start-Sleep -Milliseconds 100 }
    $state.refresh = $false
  }
}).AddArgument($state).AddArgument($Api)
$workerHandle = $worker.BeginInvoke()

# --- Icon -------------------------------------------------------------------------

# The .ico holds PNG frames that System.Drawing can't always render, so build the
# tray icon from the PNG instead.
$png = New-Object System.Drawing.Bitmap((Join-Path $Root 'assets\tempest-256.png'))
$small = New-Object System.Drawing.Bitmap($png, 32, 32)
$icon = [System.Drawing.Icon]::FromHandle($small.GetHicon())

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = $icon
$notify.Text = 'TEMPEST'
$notify.Visible = -not $SelfTest

# --- Actions (none of these wait) ------------------------------------------------------

# A launcher command still running (restart / stop), and what to do when it ends.
$script:pending = $null

function Start-Launcher([string[]]$LauncherArgs) {
  $argList = @('"' + $Launcher + '"') + ($LauncherArgs | ForEach-Object { '"' + $_ + '"' }) + @('--no-tray')
  Start-Process -FilePath $Node -ArgumentList $argList -WindowStyle Hidden -PassThru
}

function Show-Balloon([string]$Text, [string]$Kind = 'Info') {
  $notify.ShowBalloonTip(3000, 'TEMPEST', $Text, [System.Windows.Forms.ToolTipIcon]::$Kind)
}

function Show-Gm {
  if (-not [TempestWindows]::Focus($GmPattern)) { [void](Start-Launcher @()) }
}

function Open-Player {
  [void](Start-Launcher @('--open', '/player'))
}

function Restart-Server {
  if ($script:pending) { return }
  $notify.Text = 'TEMPEST: restarting...'
  $script:pending = @{ kind = 'restart'; proc = (Start-Launcher @('--restart')); doneAt = $null }
}

function Stop-Tempest {
  if ($script:pending -and $script:pending.kind -eq 'quit') { return }
  $notify.Text = 'TEMPEST: shutting down...'
  $script:pending = @{ kind = 'quit'; proc = (Start-Launcher @('--stop')); doneAt = $null }
}

function Exit-Tray {
  $timer.Stop()
  $state.stop = $true
  $notify.Visible = $false
  $notify.Dispose()
  [System.Windows.Forms.Application]::Exit()
}

function Invoke-Safely([scriptblock]$Action) {
  try { & $Action } catch { Write-TrayLog "error: $_"; Show-Balloon "Something went wrong: $($_.Exception.Message)" 'Error' }
}

# --- Menu (reads $state only) ---------------------------------------------------------

$menu = New-Object System.Windows.Forms.ContextMenuStrip

$statusItem = New-Object System.Windows.Forms.ToolStripMenuItem('TEMPEST')
$statusItem.Enabled = $false

$gmItem = New-Object System.Windows.Forms.ToolStripMenuItem('Show GM window')
$gmItem.Font = New-Object System.Drawing.Font($gmItem.Font, [System.Drawing.FontStyle]::Bold)
$gmItem.add_Click({ Invoke-Safely { Show-Gm } })

$playerItem = New-Object System.Windows.Forms.ToolStripMenuItem('Open player screen')
$playerItem.add_Click({ Invoke-Safely { Open-Player } })

$restartItem = New-Object System.Windows.Forms.ToolStripMenuItem('Restart server')
$restartItem.add_Click({ Invoke-Safely { Restart-Server } })

$autoItem = New-Object System.Windows.Forms.ToolStripMenuItem('Start with Windows')
$autoItem.add_Click({
  Invoke-Safely {
    $want = -not $autoItem.Checked
    $autoItem.Checked = $want # show the change now; the worker applies it and confirms
    $state.requests.Enqueue((@{ enabled = $want; mode = 'background' } | ConvertTo-Json -Compress))
  }
})

$quitItem = New-Object System.Windows.Forms.ToolStripMenuItem('Quit TEMPEST')
$quitItem.add_Click({ Invoke-Safely { Stop-Tempest } })

$menu.Items.AddRange(@(
  $statusItem,
  (New-Object System.Windows.Forms.ToolStripSeparator),
  $gmItem,
  $playerItem,
  (New-Object System.Windows.Forms.ToolStripSeparator),
  $restartItem,
  $autoItem,
  (New-Object System.Windows.Forms.ToolStripSeparator),
  $quitItem
))

$menu.add_Opening({
  Invoke-Safely {
    Update-Status
    $state.refresh = $true # ask the worker for fresh data for next time
  }
})

$notify.ContextMenuStrip = $menu
$notify.add_DoubleClick({ Invoke-Safely { Show-Gm } })

# --- Status + launcher tracking (UI timer; only reads state) -------------------------------

function Update-Status {
  $busy = [bool]$script:pending
  if ($busy) {
    $statusItem.Text = $(if ($script:pending.kind -eq 'quit') { 'TEMPEST: shutting down...' } else { 'TEMPEST: restarting...' })
  } elseif ($state.running) {
    $statusItem.Text = "TEMPEST $($state.version): running on port $Port"
    $notify.Text = 'TEMPEST: running'
  } else {
    $statusItem.Text = 'TEMPEST: server stopped'
    $notify.Text = 'TEMPEST: server stopped'
  }
  $restartItem.Text = $(if ($state.running) { 'Restart server' } else { 'Start server' })
  $restartItem.Enabled = -not $busy
  $autoItem.Enabled = $state.running -and -not $busy
  if ($state.autostart -and $state.requests.IsEmpty) { $autoItem.Checked = [bool]$state.autostart.enabled }
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 500
$timer.add_Tick({
  Invoke-Safely {
    # "Quit TEMPEST" from the Start Menu asks us to leave through this flag file.
    if (Test-Path $QuitFlag) {
      Remove-Item $QuitFlag -Force -ErrorAction SilentlyContinue
      $closed = [TempestWindows]::CloseAll($AnyPattern)
      Write-TrayLog "quit requested by launcher, $closed window(s) closed"
      Exit-Tray
      return
    }

    $p = $script:pending
    if ($p -and $p.proc.HasExited) {
      if ($p.kind -eq 'quit') {
        $closed = [TempestWindows]::CloseAll($AnyPattern)
        Write-TrayLog "quit: server stopped, $closed window(s) closed"
        Exit-Tray
        return
      }
      # Restart finished: wait for one fresh poll before reporting the outcome.
      if (-not $p.doneAt) { $p.doneAt = [DateTime]::UtcNow; $state.refresh = $true }
      elseif ($state.polledAt -gt $p.doneAt) {
        $script:pending = $null
        if ($state.running) { Show-Balloon 'Server restarted. Open windows reconnect on their own.' }
        else { Show-Balloon 'The server did not come back. See the log in %LOCALAPPDATA%\TEMPEST\logs.' 'Error' }
      }
    }
    Update-Status
  }
})

if ($SelfTest) {
  $deadline = [DateTime]::UtcNow.AddSeconds(8)
  while ($state.polledAt -eq [DateTime]::MinValue -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 50 }
  $openMs = (Measure-Command { Update-Status }).TotalMilliseconds
  [pscustomobject]@{
    polled = $state.polledAt -ne [DateTime]::MinValue
    running = $state.running
    status = $statusItem.Text
    autostart = [bool]$state.autostart.enabled
    playerItem = $playerItem.Text
    menuOpenMs = [math]::Round($openMs, 1)
  } | ConvertTo-Json -Compress
  $state.stop = $true
  $notify.Dispose()
  return
}

$timer.Start()
Write-TrayLog "tray started (pid $PID)"
[System.Windows.Forms.Application]::Run()

$state.stop = $true
try { [void]$workerHandle.AsyncWaitHandle.WaitOne(1500); $worker.Dispose() } catch { }
$mutex.ReleaseMutex()
$icon.Dispose()
$small.Dispose()
$png.Dispose()
Write-TrayLog 'tray stopped'
