"""Part 1: Camera Status Monitor (WPF + MVVM)."""
from bookkit import M
from reportlab.graphics.shapes import Drawing

S1 = "snack1-camera-status-monitor/"
CORE = S1 + "src/CameraMonitor.Core/"
APP = S1 + "src/CameraMonitor.App/"
TESTS = S1 + "tests/CameraMonitor.Tests/"


def mvvm_diagram(b):
    d = Drawing(486, 200)
    b.box(d, 0, 120, 150, 70, "View (XAML)", ["MainWindow.xaml", "bindings only", "no code-behind"])
    b.box(d, 168, 120, 150, 70, "ViewModel", ["MainViewModel", "DeviceViewModel", "commands, state"])
    b.box(d, 336, 120, 150, 70, "Model / services", ["Device, StatusChange", "DeviceSimulator", "(IDeviceSource)"])
    b.arrow(d, 150, 165, 168, 165, label="binds")
    b.arrow(d, 168, 145, 150, 145, label="PropertyChanged")
    b.arrow(d, 318, 165, 336, 165, label="calls")
    b.arrow(d, 336, 145, 318, 145, label="events")
    b.box(d, 168, 10, 150, 70, "IUiDispatcher", ["WpfDispatcher in the app", "Immediate/Queued in tests"])
    b.arrow(d, 243, 120, 243, 80, label="Post(work)")
    return d


def write(b):
    b.PART("Part 1", "Camera Status Monitor",
           "A WPF dashboard of cameras and doors whose status changes live. The point isn't the window: it's that "
           "everything the window does lives in ViewModels that know nothing about WPF, so 28 tests can check it "
           "without ever opening a window.")

    # ---------------- concepts ----------------
    b.H1("1.1 What it does")
    b.P("The window lists nine devices from a pretend building: five cameras and four doors, each with a name, a "
        "type, a location and a status. A background simulator changes one device every two seconds: it goes "
        "online, offline or, rarely, into alarm. The row's colour follows its status (green, grey, red), the counts "
        "at the top update, and a log on the right lists the changes, newest first.")
    b.P("You can filter the list by typing (the filter matches name, location, type, status and id), and you can "
        "select a device in alarm and acknowledge it, which puts it back online. The Acknowledge button is only "
        "enabled when the selected device is actually in alarm.")

    b.H1("1.2 MVVM in one page")
    b.P("Model-View-ViewModel splits a screen into three parts. The <b>View</b> is the XAML: layout, colours, "
        "controls. The <b>ViewModel</b> is a plain class holding the screen's state (the visible rows, the filter "
        "text, the selected device) and its actions (commands). The <b>Model</b> is the rest of the program: here, "
        "the devices and the simulator.")
    b.P("The View never calls the ViewModel's methods directly and the ViewModel never touches a control. They "
        "meet through <b>data binding</b>: XAML says " + M("Text=\"{Binding FilterText}\"") + " and WPF keeps the "
        "text box and the property in sync, in both directions. For WPF to know a property changed, the ViewModel "
        "raises " + M("INotifyPropertyChanged.PropertyChanged") + "; for lists, " + M("ObservableCollection") +
        " raises " + M("CollectionChanged") + ". Buttons bind to " + M("ICommand") + " objects, which also tell the "
        "button whether it may be clicked.")
    b.figure(mvvm_diagram(b), "Figure 1.1. Who talks to whom. Arrows into the ViewModel are the only way in; the View "
             "only binds, and threading goes through an interface the tests can replace.")
    b.P("The payoff is testability. Because " + M("ICommand") + ", " + M("INotifyPropertyChanged") + " and "
        + M("ObservableCollection") + " are in .NET's base library rather than WPF, the ViewModels can live in a "
        "plain " + M("net10.0") + " library with no reference to WPF at all, and the tests run on any operating "
        "system, including CI's Linux machines.")

    b.H1("1.3 The UI thread")
    b.P("WPF controls belong to the thread that created them, the UI thread, and throw if touched from any other. "
        "The simulator uses a " + M("System.Threading.Timer") + ", whose callbacks run on thread-pool threads. If the "
        "simulator's event updated a bound property directly, WPF would either throw or, for some changes, "
        "misbehave intermittently, which is worse.")
    b.P("The fix is to move the work onto the UI thread. WPF's " + M("Dispatcher") + " is a queue the UI thread "
        "drains between handling input and drawing; " + M("Dispatcher.BeginInvoke") + " adds work to it and returns "
        "immediately. The ViewModel doesn't call the Dispatcher itself (that would tie it to WPF): it calls an "
        + M("IUiDispatcher") + " interface, and the app supplies the WPF version.")

    # ---------------- line by line ----------------
    b.H1("1.4 The project files")
    b.P("Three projects: the core library, the WPF app and the tests. The core is the important split.")
    b.whole(CORE + "CameraMonitor.Core.csproj", "xml")
    b.P("Plain " + M("net10.0") + ": no " + M("UseWPF") + ", no Windows-only target. Anything that compiles here "
        "can't depend on WPF by accident, so the compiler enforces the architecture.")
    b.whole(APP + "CameraMonitor.App.csproj", "xml")
    b.notes(APP + "CameraMonitor.App.csproj", [
        ("<OutputType>WinExe</OutputType>", M("WinExe") + " rather than " + M("Exe") + ": no console window opens behind the app."),
        ("net10.0-windows", "The " + M("-windows") + " suffix makes Windows APIs available; WPF needs it."),
        ("EnableWindowsTargeting", "Lets the project restore and compile on Linux and macOS too. It can't run there, "
         "but CI and editors on other systems can still check it builds."),
        ("AssemblyName", "The executable is " + M("CameraMonitor.exe") + " rather than the project name."),
    ])

    b.H1("1.5 Devices and status changes")
    b.code(CORE + "Devices/Device.cs", "public enum DeviceType", "cs", end="public sealed record StatusChange")
    b.notes(CORE + "Devices/Device.cs", [
        ("public sealed class Device(", "A <b>primary constructor</b> (C# 12): the parameters in the class header are "
         "in scope for the whole class, and here initialize get-only properties. Only " + M("Status") + " can change."),
        ("public sealed record StatusChange", "A <b>record</b>: an immutable value with equality by content, ideal for "
         "an event that says what happened. Positional syntax generates the constructor, properties, "
         + M("Equals") + " and " + M("ToString") + "."),
    ])
    b.code(CORE + "Devices/Device.cs", "public static class SampleDevices", "cs")
    b.P("The collection expression " + M("[ ... ]") + " builds the list, and " + M("new(...)") + " is target-typed: "
        "the compiler knows each element is a " + M("Device") + ". One camera starts offline so the counts aren't "
        "all equal at startup.")

    b.H1("1.6 The simulator")
    b.code(CORE + "Devices/DeviceSimulator.cs", "public interface IDeviceSource", "cs")
    b.P("The ViewModel depends on this interface, not on the simulator, so tests can raise exactly the changes they "
        "want. In a real product, the same interface would sit in front of cameras and door controllers.")
    b.code(CORE + "Devices/DeviceSimulator.cs", "public sealed class DeviceSimulator(", "cs", end="public StatusChange Tick()")
    b.notes(CORE + "Devices/DeviceSimulator.cs", [
        ("private readonly Lock _gate", M("System.Threading.Lock") + " (.NET 9) is a dedicated lock object: a "
         + M("lock") + " statement on it is faster and clearer than locking on a plain " + M("object") + "."),
        ("public DeviceSimulator() : this(", "The app uses the defaults; tests pass a seeded " + M("Random") +
         " and a long interval so the timer never fires on its own."),
        ("public void Start() => _timer ??=", M("??=") + " only creates the timer if there isn't one, so calling "
         + M("Start") + " twice can't start two timers. The callback runs on a thread-pool thread."),
    ])
    b.code(CORE + "Devices/DeviceSimulator.cs", "public StatusChange Tick()", "cs")
    b.notes(CORE + "Devices/DeviceSimulator.cs", [
        ("var next = random.Next(6) switch", "A switch expression with patterns: 0 is alarm (1 in 6), 1 or 2 offline, "
         "anything else online. Alarms should be the rarest; a test checks they are."),
        ("if (next == device.Status)", "Every tick must be a real change, so picking the current status flips it instead."),
        ("StatusChanged?.Invoke(this, change);", "Raised <i>outside</i> the lock. Calling unknown code while holding "
         "a lock is how deadlocks start: a handler that waited for another thread holding the same lock would never return."),
    ])
    b.code(CORE + "Devices/DeviceSimulator.cs", "public void Acknowledge(string deviceId)", "cs")
    b.P("Acknowledging only does something for a device that's really in alarm; " + M("device is { Status: "
        "DeviceStatus.Alarm }") + " is a property pattern that also checks for null. The change goes out through the "
        "same event as any other, so the window updates the same way whatever caused it.")

    b.H1("1.7 MVVM building blocks")
    b.code(CORE + "Mvvm/ObservableObject.cs", "public abstract class ObservableObject", "cs")
    b.notes(CORE + "Mvvm/ObservableObject.cs", [
        ("[CallerMemberName]", "The compiler fills in the caller's name, so a property setter calls "
         + M("SetProperty(ref _x, value)") + " without spelling its own name, and renaming the property can't leave a stale string."),
        ("if (EqualityComparer<T>.Default.Equals(field, value)) return false;", "No change, no event. Bindings "
         "refresh on every event, so skipping no-op changes avoids needless work and update loops."),
    ])
    b.code(CORE + "Mvvm/RelayCommand.cs", "public sealed class RelayCommand(", "cs")
    b.P("A button bound to a command calls " + M("CanExecute") + " to decide whether it's enabled, and again "
        "whenever " + M("CanExecuteChanged") + " fires. WPF's own commands hook that event to a global "
        "\"requery\" signal; this one raises it explicitly, which is more predictable and works without WPF. "
        + M("Execute") + " checks " + M("CanExecute") + " again, in case it's invoked from code rather than a button.")
    b.code(CORE + "ViewModels/IUiDispatcher.cs", "public interface IUiDispatcher", "cs")

    b.H1("1.8 A row: DeviceViewModel")
    b.code(CORE + "ViewModels/DeviceViewModel.cs", "public sealed class DeviceViewModel(", "cs")
    b.notes(CORE + "ViewModels/DeviceViewModel.cs", [
        ("private readonly Device _device = device;", "The constructor parameter is copied into a field once. Using "
         "the parameter both here and in members would make the compiler warn (CS9124) that its value is captured twice, "
         "and CI treats warnings as errors."),
        ("if (SetProperty(ref _status, value)) OnPropertyChanged(nameof(IsAlarm));", M("IsAlarm") + " is computed "
         "from " + M("Status") + ", so when the status changes it has to announce that " + M("IsAlarm") + " may have "
         "changed too, or anything bound to it would go stale."),
        ("public bool Matches(string filter)", "The filter rule lives with the row it describes. "
         + M("StringComparison.OrdinalIgnoreCase") + " compares without culture rules, which is right for codes and "
         "names typed by an operator."),
    ])

    b.H1("1.9 The screen: MainViewModel")
    b.code(CORE + "ViewModels/MainViewModel.cs", "public MainViewModel(", "cs")
    b.notes(CORE + "ViewModels/MainViewModel.cs", [
        ("AllDevices = source.Devices.Select", "One " + M("DeviceViewModel") + " per device, made once. "
         + M("_byId") + " finds a row from a change in constant time."),
        ("_acknowledgeAlarm = new RelayCommand(AcknowledgeSelected", "The button's rule, in one line: enabled only "
         "when a device is selected and it's in alarm."),
        ("_source.StatusChanged += (_, change) => _dispatcher.Post(() => Apply(change));", "The key line for threading. "
         "The event arrives on the timer's thread; the handler only queues " + M("Apply") + " for the UI thread."),
    ])
    b.code(CORE + "ViewModels/MainViewModel.cs", "public string FilterText", "cs")
    b.P("Typing in the filter box sets " + M("FilterText") + " on every keystroke (the XAML asks for "
        + M("UpdateSourceTrigger=PropertyChanged") + "). The setter re-filters and tells the Clear button it may now "
        "be enabled. Changing the selection re-checks the Acknowledge button the same way.")
    b.code(CORE + "ViewModels/MainViewModel.cs", "public int OnlineCount", "cs", end="public int AlarmCount")
    b.P("Computed properties with no field: they're cheap to recount for nine devices, and they can never disagree "
        "with the rows. The ViewModel announces them when a change arrives.")
    b.code(CORE + "ViewModels/MainViewModel.cs", "private void Apply(StatusChange change)", "cs")
    b.notes(CORE + "ViewModels/MainViewModel.cs", [
        ("RecentChanges.Insert(0,", "Newest first, and trimmed to " + M("MaxRecentChanges") + " so a long-running "
         "window doesn't grow without bound."),
        ("_acknowledgeAlarm.RaiseCanExecuteChanged();", "If the selected device just went into alarm (or out of it), "
         "the button's answer changed even though the selection didn't."),
        ("if (FilterText.Length > 0) ApplyFilter();", "A filter like \"alarm\" matches on status, so a status change "
         "can move a device into or out of the filtered list."),
    ])
    b.code(CORE + "ViewModels/MainViewModel.cs", "private void ApplyFilter()", "cs")
    b.P("The obvious version, clearing " + M("VisibleDevices") + " and adding the matches, would make the ListView "
        "drop its selection and jump to the top on every status change. Instead the method removes rows that no "
        "longer match and inserts the ones that now do, at the position they have in " + M("AllDevices") + ". The "
        "list ends up in the original order, and rows that stay never leave the collection. "
        "WPF's usual tool for this, " + M("CollectionViewSource") + ", is a WPF type, so using it would pull WPF "
        "back into the core.")

    b.H1("1.10 The app: composition without code-behind")
    b.whole(APP + "App.xaml", "xaml")
    b.P("There's no " + M("App.xaml.cs") + " at all: WPF generates the " + M("App") + " class and its " + M("Main") +
        " from the XAML. Resources declared here are created when the app starts and can be found from any window "
        "with " + M("StaticResource") + ".")
    b.whole(APP + "Services/ViewModelLocator.cs", "cs")
    b.P("The <b>composition root</b>: the one place that knows which concrete classes are used. " + M("Lazy<T>") +
        " creates the ViewModel the first time the window asks for it, by which point WPF's " + M("Application") +
        " exists and " + M("WpfDispatcher") + " can capture its Dispatcher. A bigger app would use a dependency "
        "injection container here; for one window, a locator is clearer.")
    b.whole(APP + "Services/WpfDispatcher.cs", "cs")
    b.P(M("BeginInvoke") + " queues and returns; " + M("Invoke") + " would block the timer thread until the UI "
        "thread ran the work, which can deadlock if the UI thread is ever waiting on that timer.")
    b.whole(APP + "Converters/StatusToBrushConverter.cs", "cs")
    b.notes(APP + "Converters/StatusToBrushConverter.cs", [
        ("[ValueConversion(", "Documents the types for designers and tools; WPF itself doesn't require it."),
        ("Freeze(new SolidColorBrush", "A frozen brush is immutable and thread-safe, so one instance serves every row. "
         "Unfrozen WPF objects carry change-tracking overhead."),
        ("throw new NotSupportedException", "Colours never flow back into the ViewModel, so converting back is a bug "
         "worth hearing about."),
    ])

    b.H1("1.11 The window")
    b.code(APP + "MainWindow.xaml", "<Window x:Class", "xaml", end="Background=\"#F6F7F9\"")
    b.P("The " + M("DataContext") + " binding is the whole wiring: every binding inside the window is relative to "
        "the " + M("MainViewModel") + " the locator returns.")
    b.code(APP + "MainWindow.xaml", "<!-- Counts -->", "xaml", end="</StackPanel>", doc=False)
    b.P("A " + M("Run") + " is a piece of text inside a " + M("TextBlock") + ". " + M("Mode=OneWay") + " is needed "
        "because " + M("Run.Text") + " binds two-way by default, and the counts are read-only.")
    b.code(APP + "MainWindow.xaml", "<!-- Filter and acknowledge -->", "xaml", end="</DockPanel>", doc=False)
    b.code(APP + "MainWindow.xaml", "<!-- Devices -->", "xaml", end="</ListView>", doc=False)
    b.notes(APP + "MainWindow.xaml", [
        ("SelectedItem=\"{Binding SelectedDevice}\"", "Two-way: clicking a row sets " + M("SelectedDevice") + ", and "
         "the ViewModel clearing it (when the filter hides it) clears the highlight."),
        ("Fill=\"{Binding Status, Converter={StaticResource StatusBrush}}\"", "Each cell's " + M("DataContext") + " is "
         "its " + M("DeviceViewModel") + ", so " + M("Status") + " here is the row's status."),
    ])
    b.whole(APP + "MainWindow.xaml.cs", "cs")

    # ---------------- tests ----------------
    b.H1("1.12 Testing the ViewModels")
    b.P("The test project references only the core. Two fake dispatchers make threading testable, and a fake device "
        "source raises exactly the changes a test asks for.")
    b.code(TESTS + "Fakes.cs", "public sealed class ImmediateDispatcher", "cs")
    b.code(TESTS + "Fakes.cs", "public sealed class QueuedDispatcher", "cs")
    b.code(TESTS + "MainViewModelTests.cs", "public void Changes_from_the_device_thread_wait_for_the_ui_thread()", "cs")
    b.P("This is the threading guarantee as a test: after the source raises a change, nothing bound has changed, "
        "and one action is waiting. Only when the \"UI thread\" runs the queue does the row update. If someone "
        "later \"simplified\" the ViewModel to apply changes directly, this test would fail.")
    b.code(TESTS + "MainViewModelTests.cs", "[InlineData(\"server\", new[] { \"DOOR-02\" })]", "cs",
           end="Assert.Equal(expected, vm.VisibleDevices.Select(d => d.Id));")
    b.P("One theory, six cases: each " + M("[InlineData]") + " is a separate test in the results. The cases cover "
        "every field the filter reads, case-insensitivity, surrounding spaces and no match at all.")
    b.code(TESTS + "MainViewModelTests.cs", "public void Acknowledge_is_only_enabled_for_a_selected_device_in_alarm()", "cs")
    b.code(TESTS + "DeviceSimulatorTests.cs", "public void Every_tick_changes_exactly_one_device_to_a_different_status()", "cs")
    b.P("The simulator's contract, checked over 200 ticks: exactly one device changes, to a different status, and "
        "the change it reports matches what happened. The seeded " + M("Random") + " makes a failure reproducible.")
    b.T([["Test class", "Tests", "What it pins down"],
         ["MainViewModelTests", "18", "starting state, changes, threading, filter (six cases), clear, selection, acknowledge, the log cap"],
         ["DeviceSimulatorTests", "7", "one change per tick, same seed same changes, alarms rarest, events, acknowledge, the timer"],
         ["RelayCommandTests", "3", "execute, the condition, CanExecuteChanged"]], [1.7, 0.6, 4.45])

    # ---------------- practice ----------------
    b.H1("1.13 Interview questions")
    b.QA("Why is there no code in MainWindow.xaml.cs?",
         "Anything in code-behind can only be tested by creating the window. With all state and behaviour in the "
         "ViewModel, the window is a description of layout and bindings, and the ViewModel is tested directly. The "
         "same ViewModel could also back a different view, which is the talking point.")
    b.QA("The simulator raises events on a timer thread. What goes wrong if the ViewModel updates directly?",
         "WPF objects have thread affinity. Changing an " + M("ObservableCollection") + " bound to a ListView from another "
         "thread throws a " + M("NotSupportedException") + "; property changes may appear to work and fail later. The "
         "ViewModel posts every change to the UI thread through " + M("IUiDispatcher") + ".")
    b.QA("Why an IUiDispatcher interface instead of calling Application.Current.Dispatcher?",
         "It keeps WPF out of the ViewModel (so the core library has no WPF reference and tests run anywhere) and makes "
         "the threading behaviour testable: a queued fake proves nothing changes until the UI thread runs.")
    b.QA("When does a button bound to a command re-evaluate whether it's enabled?",
         "When the command raises " + M("CanExecuteChanged") + ". This ViewModel raises it when the selection changes and "
         "when a status change arrives, because either can change whether acknowledging makes sense.")
    b.QA("Why update VisibleDevices in place instead of replacing it?",
         "Replacing or clearing the collection resets the ListView: the selection is lost and it scrolls to the top, on "
         "every status change. Removing and inserting individual rows keeps both.")
    b.QA("Why freeze the brushes?",
         "A frozen Freezable can't change, so WPF skips change tracking and can share it across rows and threads.")

    b.H1("1.14 Exercises")
    b.EX("Alarm sound", "Play a sound when any device goes into alarm, without putting audio code in the ViewModel.",
         "Add an " + M("IAlarmNotifier") + " the ViewModel calls; implement it with " + M("SystemSounds") + " in the app "
         "and with a counting fake in a test.")
    b.EX("Sorting", "Let the operator sort by clicking a column header (status first, then name).",
         "Keep sorting in the ViewModel (a " + M("SortBy") + " property) and extend " + M("ApplyFilter") + " to insert in "
         "sorted order; test that a status change re-sorts.")
    b.EX("Acknowledged, not cleared", "Real systems keep an acknowledged alarm visible until it's resolved. Add an "
         "Acknowledged state with its own colour.", "Add a status and a converter case; decide what the simulator does "
         "next to an acknowledged device, and test the transitions.")
    b.EX("Stress", "Run the simulator every 10 ms for a minute and watch memory and responsiveness.",
         "Check the change log stays capped; consider batching changes that arrive within one dispatcher tick.")
