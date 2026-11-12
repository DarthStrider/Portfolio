"""Front matter and Part 0: how the four snacks fit together."""


def front(b):
    b.cover("Four Snacks, Line by Line",
            "C#, WPF, SQL Server and plugins: the Genetec projects explained",
            "A walkthrough of the four Genetec snacks: what each one does, why it is built the way it is, and the "
            "code that matters, explained line by line, with the tests that check it. Interview questions and "
            "exercises close every part.",
            [["0. The big picture", "How the snacks connect, the shared build, how to read the book"],
             ["1. Camera Status Monitor", "WPF and MVVM, commands, the UI thread, testing ViewModels"],
             ["2. Access Event Log", "SQL Server schema and indexes, Dapper, reports, contract tests, .NET Framework 4.8"],
             ["3. Mini Plugin Framework", "Reflection, AssemblyLoadContext, fault isolation, commands, configuration"],
             ["4. Web Dashboard", "ASP.NET Core minimal APIs, hosted services, React and TypeScript"],
             ["5. Keeping it working", "Lock files, Semantic Versioning, CI on Windows and Linux, Dependabot"]])


def write(b):
    pass
