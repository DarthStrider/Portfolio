using AccessLog.Core.Data;

namespace AccessLog.Tests;

public sealed class InMemoryRepositoryTests : RepositoryContract
{
    protected override Task<IAccessEventRepository> CreateAsync() =>
        Task.FromResult<IAccessEventRepository>(new InMemoryAccessEventRepository());
}
