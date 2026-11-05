// TEMPEST's Windows installer. scripts/build-installer.ps1 compiles it with the C#
// compiler that ships with Windows (.NET Framework 4.x, so C# 5 only), packing the
// built tempest folder inside it as the resource "payload.zip".
//
// It installs for the current user only (no administrator rights):
//   %LOCALAPPDATA%\Programs\TEMPEST       tempest.exe, the app's files, uninstall.exe
//   Start Menu › TEMPEST                  TEMPEST, Quit TEMPEST, Uninstall TEMPEST
//   Desktop                               TEMPEST (optional)
//   Startup                               start at sign-in (optional; tempest.exe setup --autostart)
//   Apps & features                       HKCU\…\Uninstall\TEMPEST
// The GM's projects live in %LOCALAPPDATA%\TEMPEST and are never touched, by
// installing, updating or uninstalling.
//
// Command line (also what the uninstall entry runs):
//   TEMPEST-Setup.exe [/S] [/D=<folder>] [/desktop] [/autostart] [/nolaunch] [/noshortcuts]
//   uninstall.exe /uninstall [/S]
//     /S             silent: no windows, exit code 0 on success
//     /D=<folder>    where to install (default %LOCALAPPDATA%\Programs\TEMPEST, or the current install)
//     /noshortcuts   no shortcuts and no Apps & features entry (for testing a build)

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("TEMPEST Setup")]
[assembly: AssemblyProduct("TEMPEST")]
[assembly: AssemblyDescription("Installs TEMPEST for the current user")]
[assembly: AssemblyVersion("@NUMERIC_VERSION@")]
[assembly: AssemblyFileVersion("@NUMERIC_VERSION@")]
[assembly: AssemblyInformationalVersion("@VERSION@")]

static class Setup
{
    public const string Version = "@VERSION@";
    const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\TEMPEST";

    public class Options
    {
        public string Dir;
        public bool Silent, Desktop, Autostart, Launch = true, Shortcuts = true, StartMenu = true;
    }

    [STAThread]
    static int Main(string[] args)
    {
        var o = new Options();
        bool uninstall = false, child = false;
        bool desktopGiven = false;
        foreach (var a in args)
        {
            var arg = a.Trim();
            var lower = arg.ToLowerInvariant();
            if (lower == "/s" || lower == "/silent") o.Silent = true;
            else if (lower == "/uninstall") uninstall = true;
            else if (lower == "/child") child = true;
            else if (lower == "/desktop") { o.Desktop = true; desktopGiven = true; }
            else if (lower == "/autostart") o.Autostart = true;
            else if (lower == "/nolaunch") o.Launch = false;
            else if (lower == "/noshortcuts") o.Shortcuts = false;
            else if (lower.StartsWith("/d=")) o.Dir = arg.Substring(3).Trim('"');
        }
        if (!desktopGiven && !o.Silent) o.Desktop = true;

        try
        {
            if (uninstall) return Uninstall(o, child);
            if (o.Dir == null) o.Dir = CurrentInstall() ?? DefaultDir();
            if (o.Silent)
            {
                Install(o, null);
                return 0;
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SetupForm(o));
            return 0;
        }
        catch (Exception e)
        {
            if (!o.Silent) MessageBox.Show(e.Message, "TEMPEST Setup", MessageBoxButtons.OK, MessageBoxIcon.Error);
            else Console.Error.WriteLine(e.Message);
            return 1;
        }
    }

    public static string DefaultDir()
    {
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "TEMPEST");
    }

    /// <summary>Where TEMPEST is installed now (from Apps &amp; features), or null.</summary>
    public static string CurrentInstall()
    {
        using (var key = Registry.CurrentUser.OpenSubKey(UninstallKey))
        {
            var dir = key == null ? null : key.GetValue("InstallLocation") as string;
            return dir != null && File.Exists(Path.Combine(dir, "tempest.exe")) ? dir : null;
        }
    }

    static ZipArchive Payload()
    {
        var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip");
        if (stream == null) throw new Exception("This installer is damaged: it holds no TEMPEST files.");
        return new ZipArchive(stream, ZipArchiveMode.Read);
    }

    /// <summary>The top-level files and folders TEMPEST installs (all that installing over or uninstalling removes).</summary>
    static HashSet<string> TopLevel(ZipArchive zip)
    {
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var e in zip.Entries) names.Add(e.FullName.Replace('\\', '/').Split('/')[0]);
        names.Add("uninstall.exe");
        return names;
    }

    // --- installing ------------------------------------------------------------------------

    public static void Install(Options o, Action<string, int> progress)
    {
        if (progress == null) progress = delegate { };
        var dir = Path.GetFullPath(o.Dir);
        if (File.Exists(dir)) throw new Exception(dir + " is a file, not a folder.");
        // Never empty a folder that holds something other than TEMPEST.
        if (Directory.Exists(dir) && Directory.EnumerateFileSystemEntries(dir).Any() && !File.Exists(Path.Combine(dir, "tempest.exe")))
            throw new Exception(dir + " isn't empty and doesn't hold TEMPEST. Choose an empty folder, or a TEMPEST folder to update.");

        progress("Closing TEMPEST if it's running…", 2);
        StopRunning(dir);

        using (var zip = Payload())
        {
            progress("Removing the old version…", 5);
            if (Directory.Exists(dir)) RemoveInstalled(dir, TopLevel(zip), false);
            Directory.CreateDirectory(dir);

            var entries = zip.Entries;
            var root = dir.TrimEnd('\\') + "\\";
            for (int i = 0; i < entries.Count; i++)
            {
                var e = entries[i];
                var rel = e.FullName.Replace('\\', '/');
                var dest = Path.GetFullPath(Path.Combine(dir, rel.Replace('/', '\\')));
                if (!dest.StartsWith(root, StringComparison.OrdinalIgnoreCase)) continue; // never outside the folder
                if (rel.EndsWith("/")) { Directory.CreateDirectory(dest); continue; }
                Directory.CreateDirectory(Path.GetDirectoryName(dest));
                e.ExtractToFile(dest, true);
                if (i % 25 == 0) progress("Copying files…", 5 + (int)(80.0 * i / entries.Count));
            }
        }

        // The uninstaller is this program.
        var self = Assembly.GetExecutingAssembly().Location;
        var uninstaller = Path.Combine(dir, "uninstall.exe");
        if (!string.Equals(Path.GetFullPath(self), uninstaller, StringComparison.OrdinalIgnoreCase)) File.Copy(self, uninstaller, true);

        var exe = Path.Combine(dir, "tempest.exe");
        if (o.Shortcuts)
        {
            progress("Adding shortcuts…", 88);
            // tempest.exe setup makes the Start Menu entries (and the Startup one) the same way a source install does.
            // Without /autostart, a Startup shortcut from before is left as it was (Settings in TEMPEST turns it off).
            Run(exe, o.Autostart ? "setup --autostart" : "setup");
            var menu = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "TEMPEST");
            Directory.CreateDirectory(menu);
            Shortcut(Path.Combine(menu, "Uninstall TEMPEST.lnk"), uninstaller, "/uninstall", dir, exe, "Remove TEMPEST (your projects are kept)");
            var desktop = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "TEMPEST.lnk");
            if (o.Desktop) Shortcut(desktop, exe, "", dir, exe, "TEMPEST world manager");
            else if (File.Exists(desktop)) File.Delete(desktop);

            progress("Registering with Windows…", 94);
            using (var key = Registry.CurrentUser.CreateSubKey(UninstallKey))
            {
                key.SetValue("DisplayName", "TEMPEST");
                key.SetValue("DisplayVersion", Version);
                key.SetValue("Publisher", "TEMPEST");
                key.SetValue("DisplayIcon", exe + ",0");
                key.SetValue("InstallLocation", dir);
                key.SetValue("UninstallString", "\"" + uninstaller + "\" /uninstall");
                key.SetValue("QuietUninstallString", "\"" + uninstaller + "\" /uninstall /S");
                key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                key.SetValue("EstimatedSize", (int)(FolderSize(dir) / 1024), RegistryValueKind.DWord);
                key.SetValue("InstallDate", DateTime.Now.ToString("yyyyMMdd"));
            }
        }
        progress("Installed.", 100);
        if (o.Launch) Process.Start(new ProcessStartInfo(exe) { WorkingDirectory = dir, UseShellExecute = false });
    }

    /// <summary>Quit the TEMPEST that runs from this folder, if any (its server, tray icon and windows).</summary>
    static void StopRunning(string dir)
    {
        var exe = Path.Combine(dir, "tempest.exe");
        Func<List<Process>> ours = delegate
        {
            var list = new List<Process>();
            foreach (var p in Process.GetProcessesByName("tempest"))
            {
                try
                {
                    if (string.Equals(p.MainModule.FileName, exe, StringComparison.OrdinalIgnoreCase)) list.Add(p);
                }
                catch { /* another user's, or gone */ }
            }
            return list;
        };
        if (ours().Count == 0) return;
        try { Run(exe, "--quit"); } catch { /* fall back to ending it below */ }
        for (int i = 0; i < 40 && ours().Count > 0; i++) Thread.Sleep(250);
        foreach (var p in ours())
        {
            try { p.Kill(); p.WaitForExit(5000); } catch { }
        }
    }

    /// <summary>Remove what TEMPEST installed in `dir` (only the names it installs), then the folder if empty.</summary>
    static void RemoveInstalled(string dir, HashSet<string> names, bool removeFolder)
    {
        foreach (var path in Directory.EnumerateFileSystemEntries(dir).ToList())
        {
            if (!names.Contains(Path.GetFileName(path))) continue;
            for (int attempt = 0; ; attempt++)
            {
                try
                {
                    if (Directory.Exists(path)) Directory.Delete(path, true);
                    else File.Delete(path);
                    break;
                }
                catch (Exception)
                {
                    if (attempt >= 20) throw;
                    Thread.Sleep(250); // a process that just quit can hold files a moment longer
                }
            }
        }
        if (removeFolder && !Directory.EnumerateFileSystemEntries(dir).Any()) Directory.Delete(dir);
    }

    static void Run(string exe, string args)
    {
        var p = Process.Start(new ProcessStartInfo(exe, args) { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = Path.GetDirectoryName(exe) });
        if (!p.WaitForExit(60000)) throw new Exception("\"" + Path.GetFileName(exe) + " " + args + "\" didn't finish.");
        if (p.ExitCode != 0) throw new Exception("\"" + Path.GetFileName(exe) + " " + args + "\" failed (exit code " + p.ExitCode + ").");
    }

    static void Shortcut(string lnk, string target, string args, string cwd, string icon, string description)
    {
        var type = Type.GetTypeFromProgID("WScript.Shell");
        var shell = Activator.CreateInstance(type);
        var link = type.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { lnk });
        var t = link.GetType();
        t.InvokeMember("TargetPath", BindingFlags.SetProperty, null, link, new object[] { target });
        t.InvokeMember("Arguments", BindingFlags.SetProperty, null, link, new object[] { args });
        t.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, link, new object[] { cwd });
        t.InvokeMember("IconLocation", BindingFlags.SetProperty, null, link, new object[] { icon + ",0" });
        t.InvokeMember("Description", BindingFlags.SetProperty, null, link, new object[] { description });
        t.InvokeMember("Save", BindingFlags.InvokeMethod, null, link, null);
    }

    static long FolderSize(string dir)
    {
        long size = 0;
        foreach (var f in Directory.EnumerateFiles(dir, "*", SearchOption.AllDirectories))
        {
            try { size += new FileInfo(f).Length; } catch { }
        }
        return size;
    }

    // --- uninstalling --------------------------------------------------------------------------

    static int Uninstall(Options o, bool child)
    {
        var self = Assembly.GetExecutingAssembly().Location;
        var dir = o.Dir ?? Path.GetDirectoryName(self);
        if (!File.Exists(Path.Combine(dir, "tempest.exe")))
            throw new Exception("TEMPEST isn't installed in " + dir + ".");

        // A program can't delete itself while it runs: the work is done by a copy in %TEMP%.
        if (!child)
        {
            if (!o.Silent && MessageBox.Show(
                    "Remove TEMPEST from this PC?\n\nYour projects stay in " + Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "TEMPEST") + ".",
                    "Uninstall TEMPEST", MessageBoxButtons.OKCancel, MessageBoxIcon.Question) != DialogResult.OK)
                return 2;
            var copy = Path.Combine(Path.GetTempPath(), "tempest-uninstall-" + Guid.NewGuid().ToString("N").Substring(0, 8) + ".exe");
            File.Copy(self, copy);
            var args = "/uninstall /child /D=\"" + dir + "\"" + (o.Silent ? " /S" : "") + (o.Shortcuts ? "" : " /noshortcuts");
            var p = Process.Start(new ProcessStartInfo(copy, args) { UseShellExecute = false });
            if (o.Silent)
            {
                p.WaitForExit();
                return p.ExitCode;
            }
            return 0;
        }

        StopRunning(dir);
        var exe = Path.Combine(dir, "tempest.exe");
        if (o.Shortcuts)
        {
            try { Run(exe, "setup --uninstall"); } catch { /* the folder goes anyway */ }
            var menu = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "TEMPEST");
            try { if (Directory.Exists(menu)) Directory.Delete(menu, true); } catch { }
            var desktop = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "TEMPEST.lnk");
            try { if (File.Exists(desktop)) File.Delete(desktop); } catch { }
            try { Registry.CurrentUser.DeleteSubKeyTree(UninstallKey, false); } catch { }
        }
        try
        {
            using (var zip = Payload())
            {
                var names = TopLevel(zip);
                names.Remove("uninstall.exe"); // still running (it waits for this copy): removed below
                RemoveInstalled(dir, names, false);
            }
        }
        finally
        {
            // Once both have exited: uninstall.exe, the folder if nothing else is left in it, and this copy in %TEMP%.
            Process.Start(new ProcessStartInfo("cmd.exe", "/c ping -n 3 127.0.0.1 >nul"
                + " & del /f /q \"" + Path.Combine(dir, "uninstall.exe") + "\""
                + " & rmdir \"" + dir + "\" 2>nul"
                + " & del /f /q \"" + Assembly.GetExecutingAssembly().Location + "\"")
            {
                UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden,
            });
        }
        if (!o.Silent) MessageBox.Show("TEMPEST was removed. Your projects are still in your data folder, for whenever you reinstall.", "Uninstall TEMPEST", MessageBoxButtons.OK, MessageBoxIcon.Information);
        return 0;
    }
}

/// <summary>The installer's one window: where, which shortcuts, then progress.</summary>
class SetupForm : Form
{
    readonly Setup.Options o;
    readonly TextBox folder = new TextBox();
    readonly Button browse = new Button();
    readonly CheckBox desktop = new CheckBox();
    readonly CheckBox autostart = new CheckBox();
    readonly CheckBox launch = new CheckBox();
    readonly ProgressBar bar = new ProgressBar();
    readonly Label status = new Label();
    readonly Button go = new Button();
    readonly Button cancel = new Button();
    bool done;

    static readonly Color Ink = Color.FromArgb(230, 232, 235);
    static readonly Color Dim = Color.FromArgb(162, 168, 177);
    static readonly Color Back = Color.FromArgb(24, 27, 32);
    static readonly Color Accent = Color.FromArgb(229, 72, 77);

    public SetupForm(Setup.Options options)
    {
        o = options;
        var updating = Setup.CurrentInstall() != null;
        Text = "TEMPEST " + Setup.Version + " Setup";
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        AutoScaleMode = AutoScaleMode.Dpi;
        AutoScaleDimensions = new SizeF(96F, 96F);
        Font = new Font("Segoe UI", 9.75F);
        BackColor = Back;
        ForeColor = Ink;
        ClientSize = new Size(560, 430);

        var title = new Label { Text = "TEMPEST", Font = new Font("Segoe UI", 22F, FontStyle.Bold), ForeColor = Accent, AutoSize = true, Location = new Point(24, 18) };
        var sub = new Label { Text = (updating ? "Update to " : "Install ") + "version " + Setup.Version + ", the world manager for your tabletop games.", ForeColor = Dim, AutoSize = false, Size = new Size(512, 22), Location = new Point(26, 62) };

        var where = new Label { Text = "Install to", AutoSize = true, Location = new Point(26, 100) };
        folder.Text = o.Dir;
        folder.Location = new Point(26, 122);
        folder.Size = new Size(410, 26);
        folder.BackColor = Color.FromArgb(31, 35, 42);
        folder.ForeColor = Ink;
        folder.BorderStyle = BorderStyle.FixedSingle;
        browse.Text = "Browse…";
        browse.Location = new Point(444, 120);
        browse.Size = new Size(90, 28);
        Flat(browse, false);
        browse.Click += delegate
        {
            using (var d = new FolderBrowserDialog { Description = "Choose where to install TEMPEST", SelectedPath = Directory.Exists(folder.Text) ? folder.Text : "" })
            {
                if (d.ShowDialog(this) == DialogResult.OK)
                    folder.Text = File.Exists(Path.Combine(d.SelectedPath, "tempest.exe")) || !Directory.EnumerateFileSystemEntries(d.SelectedPath).Any()
                        ? d.SelectedPath
                        : Path.Combine(d.SelectedPath, "TEMPEST");
            }
        };

        desktop.Text = "Add a desktop shortcut";
        desktop.Checked = o.Desktop;
        autostart.Text = "Start TEMPEST in the background when I sign in";
        autostart.Checked = o.Autostart;
        launch.Text = "Open TEMPEST when setup finishes";
        launch.Checked = o.Launch;
        int y = 164;
        foreach (var c in new[] { desktop, autostart, launch })
        {
            c.AutoSize = true;
            c.Location = new Point(26, y);
            c.ForeColor = Ink;
            y += 28;
        }

        var note = new Label
        {
            Text = "Installs for you only; no administrator rights needed. Start Menu shortcuts are added, and TEMPEST appears in Apps & features to uninstall. "
                + "Your projects live in %LOCALAPPDATA%\\TEMPEST and are never touched by installing, updating or uninstalling.",
            ForeColor = Dim, AutoSize = false, Size = new Size(508, 76), Location = new Point(26, 256), UseMnemonic = false,
        };

        bar.Location = new Point(26, 340);
        bar.Size = new Size(508, 8);
        bar.Visible = false;
        status.Location = new Point(26, 352);
        status.Size = new Size(508, 22);
        status.ForeColor = Dim;

        go.Text = updating ? "Update" : "Install";
        go.Size = new Size(110, 32);
        go.Location = new Point(424, 384);
        Flat(go, true);
        cancel.Text = "Cancel";
        cancel.Size = new Size(90, 32);
        cancel.Location = new Point(326, 384);
        Flat(cancel, false);
        AcceptButton = go;
        CancelButton = cancel;
        cancel.Click += delegate { Close(); };
        go.Click += delegate { if (done) Close(); else Start(); };

        Controls.AddRange(new Control[] { title, sub, where, folder, browse, desktop, autostart, launch, note, bar, status, go, cancel });
        ActiveControl = go; // the path isn't selected when the window opens
    }

    static void Flat(Button b, bool primary)
    {
        b.FlatStyle = FlatStyle.Flat;
        b.FlatAppearance.BorderColor = primary ? Accent : Color.FromArgb(74, 81, 92);
        b.BackColor = primary ? Accent : Color.FromArgb(31, 35, 42);
        b.ForeColor = primary ? Color.White : Ink;
    }

    void Start()
    {
        o.Dir = folder.Text.Trim();
        o.Desktop = desktop.Checked;
        o.Autostart = autostart.Checked;
        o.Launch = launch.Checked;
        if (o.Dir.Length == 0 || !Path.IsPathRooted(o.Dir))
        {
            MessageBox.Show(this, "Choose a full folder path, like " + Setup.DefaultDir() + ".", Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }
        foreach (Control c in Controls) if (c is CheckBox || c == folder || c == browse) c.Enabled = false;
        go.Enabled = cancel.Enabled = false;
        bar.Visible = true;
        var worker = new Thread(delegate ()
        {
            try
            {
                Setup.Install(o, delegate (string text, int pct)
                {
                    BeginInvoke((Action)delegate { status.Text = text; bar.Value = Math.Max(0, Math.Min(100, pct)); });
                });
                BeginInvoke((Action)delegate
                {
                    done = true;
                    status.Text = "TEMPEST " + Setup.Version + " is installed. Find it in the Start Menu" + (o.Desktop ? " or on your desktop." : ".");
                    go.Text = "Finish";
                    go.Enabled = true;
                });
            }
            catch (Exception e)
            {
                BeginInvoke((Action)delegate
                {
                    status.Text = "Setup didn't finish.";
                    MessageBox.Show(this, e.Message, Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
                    foreach (Control c in Controls) if (c is CheckBox || c == folder || c == browse) c.Enabled = true;
                    go.Enabled = cancel.Enabled = true;
                    bar.Visible = false;
                });
            }
        });
        worker.IsBackground = true;
        worker.Start();
    }
}
