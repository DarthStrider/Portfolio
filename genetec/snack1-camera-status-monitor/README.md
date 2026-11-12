# Camera Status Monitor

**Stack:** WPF, MVVM, C#, .NET 10  
**Effort:** ~1.5 days  
**Status:** Built

A desktop dashboard listing fake cameras and doors with live status.

## Features

- [x] `ListView` of devices (name, type, location, status), coloured via a converter: green Online, grey Offline, red Alarm
- [x] Background `DeviceSimulator` randomly flips statuses every few seconds; UI updates through the Dispatcher
- [x] Filter box and "Acknowledge alarm" button bound to an `ICommand`
- [x] Zero code-behind except `InitializeComponent()`
- [x] Live counts per status and a log of recent changes
- [x] 28 unit tests of the ViewModels, the simulator and the commands, with no window

## Talking point

"I kept the view dumb so the same ViewModel could be unit-tested or reused in another plugin."

## How to run

Needs Windows and the [.NET 10 SDK](https://dotnet.microsoft.com/download) (or Visual Studio 2022 17.14+ / 2026).
From `genetec/`:

```powershell
dotnet run --project snack1-camera-status-monitor/src/CameraMonitor.App
dotnet test --project snack1-camera-status-monitor/tests/CameraMonitor.Tests
```

Or open `genetec/Genetec.slnx` in Visual Studio and set **CameraMonitor.App** as the startup project.

Type in the filter box (try `alarm`, `door` or `ground`), select a red row and press **Acknowledge alarm**.

## How it's built

```
src/
├── CameraMonitor.Core/          net10.0, no WPF: everything that can be tested
│   ├── Devices/Device.cs        Device, DeviceStatus, StatusChange, the sample building
│   ├── Devices/DeviceSimulator.cs  IDeviceSource; flips a random device on a timer thread
│   ├── Mvvm/                    ObservableObject (INotifyPropertyChanged), RelayCommand (ICommand)
│   └── ViewModels/              MainViewModel, DeviceViewModel, IUiDispatcher
└── CameraMonitor.App/           net10.0-windows, WPF
    ├── App.xaml                 declares the ViewModelLocator and the converter as resources
    ├── MainWindow.xaml          bindings only; MainWindow.xaml.cs is just InitializeComponent()
    ├── Converters/StatusToBrushConverter.cs
    └── Services/                ViewModelLocator (composition root), WpfDispatcher
tests/CameraMonitor.Tests/       xUnit v3: MainViewModel, DeviceSimulator, RelayCommand
```

## Design decisions

- **The ViewModels don't know WPF exists.** They live in a plain `net10.0` library. `ICommand` and
  `INotifyPropertyChanged` come from the base class library, not WPF, so the tests run on Linux in
  CI and the same ViewModels could back a different view.
- **Threading behind an interface.** The simulator raises events on a thread-pool timer; WPF
  objects may only be touched from the UI thread. `MainViewModel` hands every change to
  `IUiDispatcher.Post`. The app's version uses `Dispatcher.BeginInvoke`; a test version queues the
  work, which proves nothing bound changes until the UI thread runs it.
- **Composition in XAML, not code-behind.** `App.xaml` declares a `ViewModelLocator` resource and
  the window binds `DataContext` to it, so neither `App` nor `MainWindow` has any code of its own.
- **Filtering without `ICollectionView`.** `CollectionViewSource` is a WPF type, so the ViewModel
  keeps its own `VisibleDevices` and updates it in place (removes and inserts, never clears), which
  keeps the selection and scroll position when the filter or a status changes.
- **Deterministic simulator.** `DeviceSimulator.Tick()` is public and the `Random` is injected, so a
  test with a seed sees the same changes every run.

## Tested by CI

`.github/workflows/genetec.yml` builds the whole `Genetec.slnx` on Windows (the WPF app included)
with warnings as errors, and runs every test. See [CHANGELOG.md](../CHANGELOG.md) for versions.
