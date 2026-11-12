using System.Windows;
using System.Windows.Threading;
using CameraMonitor.Core.ViewModels;

namespace CameraMonitor.App.Services;

/// <summary>IUiDispatcher backed by WPF: queues the action on the UI thread's message loop.</summary>
public sealed class WpfDispatcher : IUiDispatcher
{
    private readonly Dispatcher _dispatcher = Application.Current.Dispatcher;

    public void Post(Action action) => _dispatcher.BeginInvoke(action, DispatcherPriority.Normal);
}
