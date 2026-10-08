"""Deterministic staging only; governed by 2026-09-27-source-patchset-fabrication.md."""
from pathlib import Path
import hashlib, json, os, re, stat, sys


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def closed(value, keys):
    require(type(value) is dict and set(value) == set(keys), 'unexpected object fields')


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'duplicate JSON key')
        result[key] = value
    return result


def document(data):
    return json.loads(data.decode('utf-8'), object_pairs_hook=unique_object,
                      parse_constant=lambda _: require(False, 'nonfinite JSON'))


def path_name(value):
    require(type(value) is str and value and not value.startswith('/'), 'invalid relative path')
    parts = value.split('/')
    require(all(p not in ('.', '..') and re.fullmatch(r'[A-Za-z0-9_.-]+', p) for p in parts), 'invalid path component')
    return value


def directory_chain(directory):
    require(directory.is_absolute(), 'absolute directory required')
    for part in [*reversed(directory.parents), directory]:
        mode = part.lstat().st_mode
        require(stat.S_ISDIR(mode) and not stat.S_ISLNK(mode), 'invalid directory ancestor')


def source_state(root, name, descriptor):
    path = root / name
    # Existing ancestors of an absent file must also be safe directories.
    for parent in reversed(path.parents):
        if parent == root or root in parent.parents:
            if os.path.lexists(parent):
                require(stat.S_ISDIR(parent.lstat().st_mode), 'invalid source ancestor')
    if descriptor['state'] == 'absent':
        require(not os.path.lexists(path), 'creation target unexpectedly present')
        return {'state': 'absent'}, None
    handle = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(handle, 'rb') as stream:
        metadata = os.fstat(stream.fileno())
        require(stat.S_ISREG(metadata.st_mode), 'source is not a regular file')
        data = stream.read()
    data.decode('utf-8')
    require(sha(data) == descriptor['sha256'], 'stale input digest')
    return {'state': 'present', 'sha256': sha(data), 'mode': stat.S_IMODE(metadata.st_mode)}, data


def materialize(inventory_path, candidate_path, stage_path):
    inventory_bytes = inventory_path.read_bytes()
    candidate_bytes = candidate_path.read_bytes()
    inventory = document(inventory_bytes)
    candidate = document(candidate_bytes)
    closed(inventory, ['kind', 'version', 'sourceRoot', 'files', 'clauses'])
    require(inventory['kind'] == 'source-patchset-input' and type(inventory['version']) is int and inventory['version'] == 1, 'unsupported inventory')
    require(type(inventory['sourceRoot']) is str, 'invalid source root')
    root = Path(inventory['sourceRoot'])
    directory_chain(root)
    root = root.resolve()
    files = inventory['files']
    require(type(files) is dict and files, 'empty input inventory')
    clauses = inventory['clauses']
    require(type(clauses) is list and clauses and all(type(x) is str and x for x in clauses) and len(set(clauses)) == len(clauses), 'invalid clauses')
    names = sorted(path_name(n) for n in files)
    for name in names:
        require(not any(other != name and other.startswith(name + '/') for other in names), 'ancestor input collision')
        descriptor = files[name]
        require(type(descriptor) is dict and descriptor.get('state') in ('present', 'absent'), 'invalid input descriptor')
        if descriptor['state'] == 'present':
            closed(descriptor, ['state', 'sha256'])
            require(type(descriptor['sha256']) is str and re.fullmatch('[0-9a-f]{64}', descriptor['sha256']), 'invalid digest')
        else:
            closed(descriptor, ['state'])
    closed(candidate, ['kind', 'version', 'disposition', 'reason', 'changes'])
    require(candidate['kind'] == 'source-patchset' and type(candidate['version']) is int and candidate['version'] == 1, 'unsupported candidate')
    require(candidate['disposition'] in ('candidate', 'refused') and type(candidate['reason']) is str and type(candidate['changes']) is list, 'invalid candidate disposition')
    if candidate['disposition'] == 'refused':
        require(not candidate['changes'], 'refusal has changes')
        return {'disposition': 'refused'}
    require(candidate['changes'], 'candidate has no changes')
    stage = Path(stage_path)
    require(stage.is_absolute(), 'absolute stage required')
    directory_chain(stage.parent)
    stage = stage.parent.resolve() / stage.name
    receipt = stage.with_name(stage.name + '.receipt.json')
    require(stage != root and root not in stage.parents, 'stage lies in source root')
    require(not os.path.lexists(stage) and not os.path.lexists(receipt), 'stage or receipt already exists')
    original, output = {}, {}
    for name in names:
        original[name], output[name] = source_state(root, name, files[name])
    seen = set()
    for change in candidate['changes']:
        require(type(change) is dict, 'invalid change')
        operation = change.get('operation')
        fields = {'edit': ['operation', 'path', 'inputSha256', 'replacements', 'clauses'],
                  'create': ['operation', 'path', 'text', 'clauses'],
                  'delete': ['operation', 'path', 'inputSha256', 'clauses']}
        require(type(operation) is str and operation in fields, 'unknown operation')
        closed(change, fields[operation])
        name = path_name(change['path'])
        require(name in files and name not in seen, 'undeclared or repeated change')
        seen.add(name)
        refs = change['clauses']
        require(type(refs) is list and refs and all(type(x) is str and x in clauses for x in refs) and len(set(refs)) == len(refs), 'invalid change clauses')
        if operation == 'create':
            require(files[name]['state'] == 'absent' and type(change['text']) is str, 'invalid creation')
            output[name] = change['text'].encode('utf-8')
        else:
            require(files[name]['state'] == 'present' and change['inputSha256'] == files[name]['sha256'], 'invalid input binding')
            if operation == 'delete':
                output[name] = None
            else:
                replacements = change['replacements']
                require(type(replacements) is list and replacements, 'empty replacements')
                text = output[name].decode('utf-8')
                for replacement in replacements:
                    closed(replacement, ['before', 'after'])
                    before, after = replacement['before'], replacement['after']
                    require(type(before) is str and before and type(after) is str and text.count(before) == 1, 'ambiguous or invalid replacement')
                    text = text.replace(before, after, 1)
                output[name] = text.encode('utf-8')
    final = {}
    for name, data in output.items():
        final[name] = {'state': 'absent'} if data is None else {
            'state': 'present', 'sha256': sha(data),
            'mode': original[name].get('mode', 0o644)}
    stage.mkdir()
    for name, data in output.items():
        if data is None:
            continue
        target = stage / name
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open('xb') as stream:
            stream.write(data)
        target.chmod(final[name]['mode'])
    directory_chain(root)
    for name in names:
        current, _ = source_state(root, name, files[name])
        require(current == original[name], 'input changed during staging')
    report = {'kind': 'source-patchset-stage', 'version': 1,
              'inventorySha256': sha(inventory_bytes), 'candidateSha256': sha(candidate_bytes),
              'materializerSha256': sha(Path(__file__).read_bytes()),
              'inputs': original, 'outputs': final, 'disposition': 'staged-unaccepted'}
    with receipt.open('x', encoding='utf-8') as stream:
        stream.write(json.dumps(report, indent=2) + '\n')
    return report


if __name__ == '__main__':
    try:
        require(len(sys.argv) == 4, 'expected inventory, candidate and fresh stage paths')
        result = materialize(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]))
        print(json.dumps({'disposition': result['disposition'], 'paths': len(result.get('outputs', {}))}))
    except (OSError, ValueError, TypeError, UnicodeError, KeyError) as error:
        print(json.dumps({'disposition': 'invalid', 'errorType': type(error).__name__, 'message': str(error)[:300]}), file=sys.stderr)
        sys.exit(1)
