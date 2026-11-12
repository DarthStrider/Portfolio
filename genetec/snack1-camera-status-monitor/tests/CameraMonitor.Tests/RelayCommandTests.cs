using CameraMonitor.Core.Mvvm;

namespace CameraMonitor.Tests;

public class RelayCommandTests
{
    [Fact]
    public void Executes_when_there_is_no_condition()
    {
        var runs = 0;
        var command = new RelayCommand(() => runs++);

        Assert.True(command.CanExecute(null));
        command.Execute(null);

        Assert.Equal(1, runs);
    }

    [Fact]
    public void Does_not_execute_while_the_condition_is_false()
    {
        var allowed = false;
        var runs = 0;
        var command = new RelayCommand(() => runs++, () => allowed);

        command.Execute(null);
        Assert.Equal(0, runs);

        allowed = true;
        command.Execute(null);
        Assert.Equal(1, runs);
    }

    [Fact]
    public void Raise_can_execute_changed_notifies_listeners()
    {
        var command = new RelayCommand(() => { });
        var notified = 0;
        command.CanExecuteChanged += (_, _) => notified++;

        command.RaiseCanExecuteChanged();

        Assert.Equal(1, notified);
    }
}
