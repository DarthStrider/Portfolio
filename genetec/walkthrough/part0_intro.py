"""Front matter and Part 0: how the four snacks fit together."""
from bookkit import M
from reportlab.graphics.shapes import Drawing


def front(b):
    b.cover("Four Snacks, Line by Line",
            "C#, WPF, SQL Server and plugins: the Genetec projects explained",
            "A walkthrough of the four Genetec snacks: what each one does, why it's built the way it is, and the "
            "code that matters, explained line by line, with the tests that check it. Interview questions and "
            "exercises close every part.",
            [["0. The big picture", "How the snacks connect, the solution layout, how to read the book"],
             ["1. Camera Status Monitor", "WPF and MVVM, commands, the UI thread, testing ViewModels"],
             ["2. Access Event Log", "SQL Server schema and indexes, Dapper, reports, contract tests, .NET Framework 4.8"],
             ["3. Mini Plugin Framework", "Reflection, AssemblyLoadContext, fault isolation, commands, configuration"],
             ["4. Web Dashboard", "ASP.NET Core minimal APIs, hosted services, React and TypeScript"],
             ["5. Keeping it working", "Lock files, Semantic Versioning, CI on Windows and Linux, Dependabot"]])


def map_diagram(b):
    d = Drawing(486, 170)
    b.box(d, 0, 95, 150, 65, "1. Camera Monitor", ["WPF, .NET 10", "live device status"])
    b.box(d, 168, 95, 150, 65, "2. Access Event Log", ["WPF, .NET Framework 4.8", "SQL Server, Dapper"])
    b.box(d, 336, 95, 150, 65, "4. Web Dashboard", ["ASP.NET Core + React", "same events on the web"])
    b.box(d, 84, 5, 318, 60, "3. Plugin Framework", ["host + modules loaded at run time", "door events → email, auto-lock"])
    b.arrow(d, 150, 127, 168, 127, label="same devices")
    b.arrow(d, 336, 127, 318, 127, label="reuses AccessLog.Core")
    return d


def write(b):
    b.PART("Part 0", "The big picture",
           "Four small projects mirroring Genetec's stack: desktop security software in C# and WPF, SQL Server, "
           "frameworks that save each project from starting from scratch, and a little web.")

    b.H1("0.1 How the snacks connect")
    b.figure(map_diagram(b), "Figure 0.1. The snacks share a building: the same cameras and doors throughout.")
    b.T([["Snack", "Shows", "Talking point"],
         ["1. Camera Status Monitor", "WPF, MVVM, commands, converters, thread hand-off, no code-behind",
          "\"I kept the view dumb so the same ViewModel could be unit-tested or reused in another plugin.\""],
         ["2. Access Event Log", "Schema design, constraints, indexes, GROUP BY reports, Dapper, contract tests, .NET Framework 4.8",
          "Mirrors the L3Harris grading/replay queries."],
         ["3. Mini Plugin Framework", "Reflection, load contexts, a stable contract, fault isolation, commands",
          "Connects to Unreal tools and Python build automation work."],
         ["4. Web Dashboard", "Minimal APIs, DI, hosted services, React + TypeScript, API tests", "Optional; reuses Snack 2 unchanged."]],
        [1.55, 2.75, 2.45])

    b.H1("0.2 The solution")
    b.P("All four snacks are one solution, " + M("genetec/Genetec.slnx") + " (the newer XML solution format), so "
        "one " + M("dotnet build") + " builds everything and one " + M("dotnet test") + " runs all 141 .NET tests (Snack 4's page has 9 more, run by npm). "
        "Each snack keeps the same shape: " + M("src/") + " for code, " + M("tests/") + " for tests.")
    b.whole("Genetec.slnx", "xml")
    b.P("A consistent idea runs through every snack: <b>the part worth testing never depends on the part that's hard "
        "to test</b>. ViewModels don't reference WPF. Reports are behind an interface with an in-memory twin. The plugin "
        "host doesn't reference any module. The web API's store and clock are injected.")

    b.H1("0.3 How to read this book")
    b.P("Each part opens with what the snack does and the ideas it relies on, then goes through the code file by "
        "file. Listings are the real files with real line numbers; the bold \"Line n\" notes underneath refer to them. "
        "Each part ends with how it's tested, interview questions with answers, and exercises.")
    b.P("Two ways to read it. Preparing for an interview: the opening sections of each part, the tests section, and "
        "the questions. Extending the code: read the line-by-line sections with the project open beside the book.")
    b.CALL("The book is generated from the source by " + M("walkthrough/build_walkthrough.py") + ". If you change "
           "the code, run it again (" + M("python3 walkthrough/build_walkthrough.py") + ", needs " + M("reportlab") +
           "): the line numbers are recomputed, and a listing whose anchor text has gone stops the build instead of "
           "quietly showing the wrong lines.")
