import json
import platform
import sys

from wormhole_sidecar import __version__
from wormhole_sidecar.community import detect_communities
from wormhole_sidecar.graph_metrics import compute_graph_metrics
from wormhole_sidecar.media_image import dependency_report as image_dependency_report
from wormhole_sidecar.media_image import inspect_image
from wormhole_sidecar.media_pdf import dependency_report as pdf_dependency_report
from wormhole_sidecar.media_pdf import extract_pdf
from wormhole_sidecar.policy_train import compare_policy_baselines, evaluate_policy, train_policy
from wormhole_sidecar.trace_analysis import summarize_traces


def run_job(request):
    job = request.get("job")
    payload = request.get("payload") or {}

    if job == "probe":
        return {
            "runtime": "python",
            "package": "wormhole_sidecar",
            "version": __version__,
            "pythonVersion": platform.python_version(),
        }
    if job == "graph_metrics":
        return compute_graph_metrics(payload)
    if job == "trace_summary":
        return summarize_traces(payload)
    if job == "graph_communities":
        return detect_communities(payload)
    if job == "media_dependency_report":
        return {
            "pdf": pdf_dependency_report(),
            "image": image_dependency_report(),
        }
    if job == "pdf_extract":
        return extract_pdf(payload)
    if job == "image_inspect":
        return inspect_image(payload)
    if job == "policy_train":
        return train_policy(payload)
    if job == "policy_evaluate":
        return evaluate_policy(payload)
    if job == "policy_compare_baselines":
        return compare_policy_baselines(payload)

    raise ValueError(f"Unsupported sidecar job: {job}")


def main():
    if len(sys.argv) == 2 and sys.argv[1] != "--stdin":
        request_text = sys.argv[1]
    elif len(sys.argv) == 1 or (len(sys.argv) == 2 and sys.argv[1] == "--stdin"):
        if sys.stdin.isatty():
            print(
                json.dumps(
                    {
                        "ok": False,
                        "job": "probe",
                        "error": "Expected one JSON request argument or JSON request on stdin",
                    }
                )
            )
            return 2
        request_text = sys.stdin.read()
    else:
        print(
            json.dumps(
                {
                    "ok": False,
                    "job": "probe",
                    "error": "Expected one JSON request argument or JSON request on stdin",
                }
            )
        )
        return 2

    try:
        request = json.loads(request_text)
        result = run_job(request)
        print(json.dumps({"ok": True, "job": request.get("job"), "result": result}, sort_keys=True))
        return 0
    except Exception as error:
        job = "probe"
        try:
            job = json.loads(request_text).get("job", "probe")
        except Exception:
            pass
        print(json.dumps({"ok": False, "job": job, "error": str(error)}, sort_keys=True))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
