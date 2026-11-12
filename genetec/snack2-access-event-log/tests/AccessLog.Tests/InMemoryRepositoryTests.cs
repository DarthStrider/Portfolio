using AccessLog.Core.Data;
using AccessLog.Core.Model;

namespace AccessLog.Tests;

public sealed class InMemoryRepositoryTests : RepositoryContract
{
    protected override Task<IAccessEventRepository> CreateAsync() =>
        Task.FromResult<IAccessEventRepository>(new InMemoryAccessEventRepository());

    [Fact]
    public async Task A_badge_swipe_without_a_cardholder_breaks_the_same_rule_as_the_check_constraint()
    {
        await Assert.ThrowsAsync<InvalidOperationException>(() => Repo.RecordAsync(new AccessEvent
        {
            OccurredAtUtc = Now, DeviceId = MainDoor.Id, Kind = EventKind.BadgeSwipe, Granted = true,
        }));
    }
}
