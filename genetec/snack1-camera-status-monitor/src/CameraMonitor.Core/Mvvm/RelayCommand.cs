using System.Windows.Input;

namespace CameraMonitor.Core.Mvvm;

/// <summary>
/// An ICommand made of two delegates. ICommand lives in System.ObjectModel, not WPF, so commands
/// can be created and tested without a window. WPF calls CanExecute again when
/// CanExecuteChanged fires, which enables or disables the bound button.
/// </summary>
public sealed class RelayCommand(Action execute, Func<bool>? canExecute = null) : ICommand
{
    public event EventHandler? CanExecuteChanged;

    public bool CanExecute(object? parameter) => canExecute?.Invoke() ?? true;

    public void Execute(object? parameter)
    {
        if (CanExecute(parameter)) execute();
    }

    public void RaiseCanExecuteChanged() => CanExecuteChanged?.Invoke(this, EventArgs.Empty);
}
