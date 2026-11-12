using CameraMonitor.Core.Devices;
using CameraMonitor.Core.ViewModels;

namespace CameraMonitor.App.Services;

/// <summary>
/// Builds the object graph once and hands the window its ViewModel. Declared as a resource in
/// App.xaml, so no code-behind is needed to wire anything up.
/// </summary>
public sealed class ViewModelLocator
{
    private readonly Lazy<MainViewModel> _main = new(() =>
    {
        var viewModel = new MainViewModel(new DeviceSimulator(), new WpfDispatcher());
        viewModel.Start();
        return viewModel;
    });

    public MainViewModel Main => _main.Value;
}
