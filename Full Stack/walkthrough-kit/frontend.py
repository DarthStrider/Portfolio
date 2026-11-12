"""The React front end and its container. node-postgres and dotnet-sqlserver share it file for file
(only src/config.ts differs), so both books use this chapter."""
from bookkit import M


def write(b, part, stack_label, web_port):
    n = part
    b.PART(f"Part {n}", "The front end",
           "One React component, a typed API client, and nginx in front. The page never knows which backend it's "
           "talking to: every call goes to /api, and whoever answers there is the API. That's why this front end is "
           "shared, file for file, by the Node and the .NET versions of the tracker.")

    b.H1(f"{n}.1 Where the page comes from")
    b.whole("frontend/index.html", "html")
    b.whole("frontend/src/main.tsx", "tsx")
    b.notes("frontend/src/main.tsx", [
        ("createRoot(document.getElementById(\"root\")!)", "React takes over the empty " + M("&lt;div id=\"root\"&gt;") +
         ". The " + M("!") + " tells TypeScript \"this isn't null\"; index.html guarantees it."),
        ("<StrictMode>", "In development only, React runs effects twice to flush out code that isn't safe to re-run. "
         "It's why the initial load in App.tsx must be harmless to repeat (it is: it just fetches)."),
    ])
    b.whole("frontend/src/config.ts", "ts")
    b.P("The only file that differs between the two projects. This one says " + M(stack_label) + ".")

    b.H1(f"{n}.2 The API client")
    b.code("frontend/src/api.ts", "export interface Task", "ts")
    b.P(M("createdAt") + " is a " + M("string") + " here but a date on the server: JSON has no date type, so it "
        "arrives as ISO text. The type says what's really on the wire.")
    b.code("frontend/src/api.ts", "async function request<T>", "ts")
    b.notes("frontend/src/api.ts", [
        ("const res = await fetch(`/api${path}`, {", "A relative URL: the same origin that served the page. In "
         "development Vite forwards " + M("/api") + "; in Docker and Kubernetes, nginx does."),
        ("...init,", "Spread after the default headers, so a caller could override them; method and body come from here."),
        ("if (!res.ok) {", M("fetch") + " only rejects on network failure. A 400 or 500 is a successful fetch, so "
         "the status has to be checked."),
        ("const body = await res.json().catch(() => null);", "Use the API's own " + M("{ error }") + " message if "
         "there is one. A proxy's 502 page isn't JSON, so parsing can fail; then fall back to the status."),
        ("return res.status === 204 ? (undefined as T) : res.json();", "204 No Content has no body, and calling "
         + M(".json()") + " on it would throw."),
    ])
    b.code("frontend/src/api.ts", "export const api = {", "ts", end="};")
    b.P(M("Partial<Pick<Task, \"title\" | \"done\">>") + " builds the update type from " + M("Task") + ": pick two "
        "fields, make both optional. Rename " + M("done") + " in " + M("Task") + " and this follows; you can't send a "
        "field the API doesn't take.")

    b.H1(f"{n}.3 The component")
    b.code("frontend/src/App.tsx", "export default function App() {", "tsx", end="const [servedBy, setServedBy]")
    b.P("Five pieces of state. Each " + M("useState") + " returns the current value and a setter; calling the "
        "setter re-renders the component with the new value.")
    b.code("frontend/src/App.tsx", "async function run(", "tsx", end="}, []);")
    b.notes("frontend/src/App.tsx", [
        ("async function run(action: () => Promise<void>) {", "Every user action goes through " + M("run") + ": clear "
         "the old error, try, and show any failure. Error handling is written once."),
        ("setServedBy((await api.info()).hostname);", "With two API replicas behind a Kubernetes Service, refreshing "
         "shows the pod name change: load balancing you can see."),
        ("}, []);", "An empty dependency list: run once, when the component first appears. " + M("finally") +
         " clears the loading state whether the load worked or not."),
    ])
    b.code("frontend/src/App.tsx", "function add(e: FormEvent) {", "tsx")
    b.P(M("e.preventDefault()") + " stops the browser's own form submit, which would reload the page. After a "
        "change, the page re-reads the list from the API rather than editing its own copy: one extra request, but "
        "what you see is what the database has.")
    a = b.ln("frontend/src/App.tsx", "{loading ? (")
    b.lines("frontend/src/App.tsx", a, b.ln("frontend/src/App.tsx", "</ul>", a) + 1, "tsx")
    b.notes("frontend/src/App.tsx", [
        ("<li key={t.id}", M("key") + " lets React match list items between renders. The database id is stable; an "
         "array index would shift when a task is deleted."),
        ("aria-label={`Delete ${t.title}`}", "The button shows only ×; the label tells a screen reader which task it deletes."),
    ])

    b.H1(f"{n}.4 Development and production")
    b.whole("frontend/vite.config.ts", "ts")
    b.whole("frontend/nginx.conf", "conf")
    b.notes("frontend/nginx.conf", [
        ("proxy_pass http://api:8080;", "\"api\" is a DNS name: the compose service in Docker, the Service in "
         "Kubernetes. Neither the page nor nginx needs an IP address."),
        ("try_files $uri /index.html;", "A file if it exists, otherwise the app. Standard for single-page apps, so a "
         "deep link doesn't 404."),
    ])
    b.whole("frontend/Dockerfile", "docker")
    b.P("A <b>multi-stage build</b>. The first stage has Node, every dev dependency and the source; it produces a "
        "folder of static files. The final image is nginx plus that folder: no Node, no " + M("node_modules") + ", "
        "a few tens of megabytes. " + M("npm ci") + " installs exactly what " + M("package-lock.json") + " records.")
    b.P(f"Under Docker Compose the page is on {M('http://localhost:' + str(web_port))}.")

    b.H1(f"{n}.5 Testing the client without a browser")
    b.code("frontend/tests/api.test.ts", "function respond(", "ts")
    b.P("The test replaces the global " + M("fetch") + " with a fake that records the request and returns a canned "
        + M("Response") + " (Node 18+ has the same " + M("Response") + " class as the browser). " + M("afterEach") +
        " puts the real one back.")
    b.code("frontend/tests/api.test.ts", "test(\"an error response throws the API's own message\"", "ts", end="});", doc=False)
    b.P("These check the edges of the client: the URL and method of each call, the JSON body, 204 handling, and both "
        "error paths. Run them with " + M("npm test") + " in " + M("frontend/") + ".")

    b.H1(f"{n}.6 Interview questions")
    b.QA("Why does fetch not throw on a 404?",
         "It only rejects when there's no response at all (network error, CORS). Any HTTP response, including errors, "
         "resolves; you check " + M("res.ok") + " or the status yourself.")
    b.QA("Why proxy /api instead of calling the API's URL from the browser?",
         "Same origin: no CORS, no API address baked into the build, and the same image works in Compose, Kubernetes "
         "or anywhere the name \"api\" resolves.")
    b.QA("Why not update the task list locally after a change?",
         "It's simpler and always matches the database. For a busier app you'd update optimistically and roll back on error.")
