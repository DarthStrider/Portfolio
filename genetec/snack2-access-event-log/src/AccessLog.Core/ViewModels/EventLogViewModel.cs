using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;
using System.Threading.Tasks;
using System.Windows.Input;
using AccessLog.Core.Data;
using AccessLog.Core.Model;
using AccessLog.Core.Mvvm;
using AccessLog.Core.Simulation;

namespace AccessLog.Core.ViewModels;

public enum OutcomeFilter
{
    All,
    Granted,
    Denied,
    StatusChanges,
}

/// <summary>
/// The event list and the two reports. All data comes through the repository, so the same
/// ViewModel works on SQL Server and in memory, and the tests use the in-memory one.
/// </summary>
public sealed class EventLogViewModel : ObservableObject
{
    public const int ReportHours = 24;
    public const int TopDevices = 5;

    private readonly IAccessEventRepository _repository;
    private readonly IClock _clock;
    private string _searchText = "";
    private OutcomeFilter _outcome = OutcomeFilter.All;
    private string _status = "";
    private DateTime? _lastRefreshedUtc;
    private bool _refreshAgain;
    private Task? _refreshing;

    public EventLogViewModel(IAccessEventRepository repository, IClock clock, string storeDescription)
    {
        _repository = repository;
        _clock = clock;
        StoreDescription = storeDescription;
        var refresh = new AsyncRelayCommand(RefreshAsync);
        RefreshCommand = refresh;
        ClearFiltersCommand = new AsyncRelayCommand(() =>
        {
            _searchText = "";
            _outcome = OutcomeFilter.All;
            OnPropertyChanged(nameof(SearchText));
            OnPropertyChanged(nameof(Outcome));
            return RefreshAsync();
        });
    }

    /// <summary>"SQL Server (AccessLog on localhost)" or "In memory", shown in the status bar.</summary>
    public string StoreDescription { get; }

    public ObservableCollection<AccessEventView> Events { get; } = [];
    public ObservableCollection<DeniedByDoorRow> DeniedByDoor { get; } = [];
    public ObservableCollection<NoisyDeviceRow> NoisiestDevices { get; } = [];

    public IReadOnlyList<OutcomeFilter> OutcomeOptions { get; } =
        [OutcomeFilter.All, OutcomeFilter.Granted, OutcomeFilter.Denied, OutcomeFilter.StatusChanges];

    public ICommand RefreshCommand { get; }
    public ICommand ClearFiltersCommand { get; }

    /// <summary>Filters the list by device, location or cardholder. Changing it refreshes.</summary>
    public string SearchText
    {
        get => _searchText;
        set
        {
            if (SetProperty(ref _searchText, value ?? "")) _ = RefreshAsync();
        }
    }

    public OutcomeFilter Outcome
    {
        get => _outcome;
        set
        {
            if (SetProperty(ref _outcome, value)) _ = RefreshAsync();
        }
    }

    public string Status
    {
        get => _status;
        private set => SetProperty(ref _status, value);
    }

    public DateTime? LastRefreshedUtc
    {
        get => _lastRefreshedUtc;
        private set => SetProperty(ref _lastRefreshedUtc, value);
    }

    /// <summary>The query the current filters describe.</summary>
    public EventQuery CurrentQuery() => new()
    {
        Text = string.IsNullOrWhiteSpace(SearchText) ? null : SearchText.Trim(),
        Kind = Outcome switch
        {
            OutcomeFilter.Granted or OutcomeFilter.Denied => EventKind.BadgeSwipe,
            OutcomeFilter.StatusChanges => EventKind.StatusChange,
            _ => null,
        },
        Granted = Outcome switch
        {
            OutcomeFilter.Granted => true,
            OutcomeFilter.Denied => false,
            _ => null,
        },
        Limit = 200,
    };

    /// <summary>
    /// Reloads the list and both reports. If a refresh is already running, this one waits for it
    /// and then runs once more, so the last filter change always wins and queries never overlap.
    /// </summary>
    public Task RefreshAsync()
    {
        if (_refreshing is { IsCompleted: false })
        {
            _refreshAgain = true;
            return _refreshing;
        }
        _refreshing = RefreshLoopAsync();
        return _refreshing;
    }

    private async Task RefreshLoopAsync()
    {
        do
        {
            _refreshAgain = false;
            try
            {
                var since = _clock.UtcNow.AddHours(-ReportHours);
                var events = await _repository.SearchAsync(CurrentQuery());
                var denied = await _repository.DeniedByDoorAsync(since);
                var noisy = await _repository.NoisiestDevicesAsync(since, TopDevices);

                Replace(Events, events);
                Replace(DeniedByDoor, denied);
                Replace(NoisiestDevices, noisy);
                LastRefreshedUtc = _clock.UtcNow;
                Status = $"{events.Count} events shown · {denied.Sum(d => d.Denied)} denied in the last {ReportHours} h";
            }
            catch (Exception e)
            {
                Status = "Couldn't load events: " + e.Message;
            }
        } while (_refreshAgain);
    }

    private static void Replace<T>(ObservableCollection<T> target, IEnumerable<T> items)
    {
        target.Clear();
        foreach (var item in items) target.Add(item);
    }
}
