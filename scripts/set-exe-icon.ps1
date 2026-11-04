# Replaces the icon of a Windows executable with an .ico file, using Windows' own
# resource API (no third-party tools). Used by scripts/build-binaries.js.
#   powershell -File scripts/set-exe-icon.ps1 -Exe dist\...\tempest.exe -Icon assets\tempest.ico
param(
  [Parameter(Mandatory = $true)] [string]$Exe,
  [Parameter(Mandatory = $true)] [string]$Icon
)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;

public static class TempestExeIcon {
  const uint LOAD_LIBRARY_AS_DATAFILE = 0x2;
  static readonly IntPtr RT_ICON = (IntPtr)3, RT_GROUP_ICON = (IntPtr)14;

  delegate bool NameProc(IntPtr module, IntPtr type, IntPtr name, IntPtr param);
  delegate bool LangProc(IntPtr module, IntPtr type, IntPtr name, ushort lang, IntPtr param);

  [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr LoadLibraryEx(string file, IntPtr reserved, uint flags);
  [DllImport("kernel32")] static extern bool FreeLibrary(IntPtr module);
  [DllImport("kernel32", CharSet = CharSet.Unicode)] static extern bool EnumResourceNames(IntPtr module, IntPtr type, NameProc cb, IntPtr param);
  [DllImport("kernel32", CharSet = CharSet.Unicode)] static extern bool EnumResourceLanguages(IntPtr module, IntPtr type, IntPtr name, LangProc cb, IntPtr param);
  [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr BeginUpdateResource(string file, bool deleteExisting);
  [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool UpdateResource(IntPtr update, IntPtr type, IntPtr name, ushort lang, byte[] data, uint size);
  [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool UpdateResource(IntPtr update, IntPtr type, string name, ushort lang, byte[] data, uint size);
  [DllImport("kernel32", SetLastError = true)] static extern bool EndUpdateResource(IntPtr update, bool discard);

  class Res { public string Str; public IntPtr Id; public ushort Lang; }

  static List<Res> List(IntPtr module, IntPtr type) {
    var names = new List<object>();
    EnumResourceNames(module, type, (m, t, n, p) => {
      if (((long)n >> 16) == 0) names.Add(n); else names.Add(Marshal.PtrToStringUni(n));
      return true;
    }, IntPtr.Zero);
    var all = new List<Res>();
    foreach (var name in names) {
      string str = name as string;
      IntPtr ptr = str != null ? Marshal.StringToHGlobalUni(str) : (IntPtr)name;
      EnumResourceLanguages(module, type, ptr, (m, t, n, lang, p) => {
        all.Add(new Res { Str = str, Id = str == null ? ptr : IntPtr.Zero, Lang = lang });
        return true;
      }, IntPtr.Zero);
      if (str != null) Marshal.FreeHGlobal(ptr);
    }
    return all;
  }

  static void Update(IntPtr h, IntPtr type, Res r, byte[] data) {
    bool ok = r.Str != null
      ? UpdateResource(h, type, r.Str, r.Lang, data, data == null ? 0u : (uint)data.Length)
      : UpdateResource(h, type, r.Id, r.Lang, data, data == null ? 0u : (uint)data.Length);
    if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error());
  }

  public static void Set(string exe, string ico) {
    byte[] file = File.ReadAllBytes(ico);
    int count = BitConverter.ToUInt16(file, 4);

    IntPtr module = LoadLibraryEx(exe, IntPtr.Zero, LOAD_LIBRARY_AS_DATAFILE);
    if (module == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
    List<Res> groups, icons;
    try { groups = List(module, RT_GROUP_ICON); icons = List(module, RT_ICON); }
    finally { FreeLibrary(module); }

    // The new group takes the place (name, language) of the first existing one, so
    // Explorer and the taskbar pick it; with no icon yet, it becomes group 1.
    Res target = groups.Count > 0 ? groups[0] : new Res { Id = (IntPtr)1, Lang = 0x0409 };

    IntPtr h = BeginUpdateResource(exe, false);
    if (h == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
    try {
      foreach (var g in groups) Update(h, RT_GROUP_ICON, g, null);
      foreach (var i in icons) Update(h, RT_ICON, i, null);

      var group = new MemoryStream();
      var w = new BinaryWriter(group);
      w.Write((ushort)0); w.Write((ushort)1); w.Write((ushort)count);
      for (int k = 0; k < count; k++) {
        int e = 6 + 16 * k;
        int size = BitConverter.ToInt32(file, e + 8), offset = BitConverter.ToInt32(file, e + 12);
        byte[] image = new byte[size];
        Array.Copy(file, offset, image, 0, size);
        Update(h, RT_ICON, new Res { Id = (IntPtr)(k + 1), Lang = target.Lang }, image);
        w.Write(file, e, 12);          // width, height, colours, reserved, planes, bit count, size
        w.Write((ushort)(k + 1));      // the RT_ICON id holding this image
      }
      Update(h, RT_GROUP_ICON, target, group.ToArray());
    } catch {
      EndUpdateResource(h, true);
      throw;
    }
    if (!EndUpdateResource(h, false)) throw new Win32Exception(Marshal.GetLastWin32Error());
  }
}
'@

[TempestExeIcon]::Set((Resolve-Path $Exe).Path, (Resolve-Path $Icon).Path)
