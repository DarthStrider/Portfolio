using TaskApi;

namespace TaskApi.Tests;

public class TaskRulesTests
{
    [Theory]
    [InlineData("a")]
    [InlineData("Buy milk")]
    [InlineData("  padded  ")]
    public void Accepts_titles_with_text(string title) =>
        Assert.True(TaskRules.IsValidTitle(title));

    [Fact]
    public void Accepts_exactly_the_maximum_length() =>
        Assert.True(TaskRules.IsValidTitle(new string('x', TaskRules.MaxTitleLength)));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("\t\n")]
    public void Rejects_missing_or_blank_titles(string? title) =>
        Assert.False(TaskRules.IsValidTitle(title));

    [Fact]
    public void Rejects_one_character_over_the_maximum() =>
        Assert.False(TaskRules.IsValidTitle(new string('x', TaskRules.MaxTitleLength + 1)));
}
