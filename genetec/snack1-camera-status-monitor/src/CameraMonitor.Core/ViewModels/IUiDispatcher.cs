namespace CameraMonitor.Core.ViewModels;

/// <summary>
/// Runs an action on the UI thread. WPF objects can only be touched from the thread that created
/// them, and the simulator raises events on a timer thread. The app supplies a version backed by
/// WPF's Dispatcher; tests supply one that runs actions immediately or queues them.
/// </summary>
public interface IUiDispatcher
{
    void Post(Action action);
}
