import { McpError, ErrorCode } from '../lib/utils';
import { makeAdtRequest, return_error, getBaseUrl } from '../lib/utils';

interface UnitAlert {
    kind: string;
    severity: string;
    title: string;
    details: string;
}

interface UnitMethod {
    name: string;
    passed: boolean;
    executionTime: string;
    alerts: UnitAlert[];
}

interface UnitClass {
    name: string;
    alerts: UnitAlert[];
    methods: UnitMethod[];
}

function attr(source: string, name: string): string {
    const match = source.match(new RegExp(`(?:^|[\\s:])${name}="([^"]*)"`));
    return match ? match[1] : '';
}

function decodeXml(text: string): string {
    return text
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}

function parseAlerts(xml: string): UnitAlert[] {
    const alerts: UnitAlert[] = [];
    const blocks = xml.match(/<(?:\w+:)?alert\b[\s\S]*?<\/(?:\w+:)?alert>/gi) || [];
    for (const block of blocks) {
        const head = block.match(/<(?:\w+:)?alert\b[^>]*>/i)?.[0] || '';
        const title = block.match(/<(?:\w+:)?title>([\s\S]*?)<\/(?:\w+:)?title>/i)?.[1] || '';
        const details = (block.match(/<(?:\w+:)?detail\b[^>]*>/gi) || [])
            .map((d) => decodeXml(attr(d, 'text')))
            .filter(Boolean)
            .join(' | ');
        alerts.push({
            kind: attr(head, 'kind'),
            severity: attr(head, 'severity'),
            title: decodeXml(title.trim()),
            details,
        });
    }
    return alerts;
}

function parseClasses(xml: string): UnitClass[] {
    const classes: UnitClass[] = [];
    const classBlocks = xml.match(/<(?:\w+:)?testClass\b[\s\S]*?<\/(?:\w+:)?testClass>/gi) || [];
    for (const classBlock of classBlocks) {
        const head = classBlock.match(/<(?:\w+:)?testClass\b[^>]*>/i)?.[0] || '';
        const methods: UnitMethod[] = [];
        const methodRegex = /<(?:\w+:)?testMethod\b[^>]*?(?:\/>|>[\s\S]*?<\/(?:\w+:)?testMethod>)/gi;
        const methodBlocks = classBlock.match(methodRegex) || [];
        for (const methodBlock of methodBlocks) {
            const methodHead = methodBlock.match(/<(?:\w+:)?testMethod\b[^>]*>/i)?.[0] || '';
            const alerts = parseAlerts(methodBlock);
            methods.push({
                name: attr(methodHead, 'adtcore:name'),
                passed: alerts.length === 0,
                executionTime: attr(methodHead, 'executionTime'),
                alerts,
            });
        }
        // Whatever alerts remain outside the method blocks belong to the class itself.
        classes.push({
            name: attr(head, 'adtcore:name'),
            alerts: parseAlerts(classBlock.replace(methodRegex, '')),
            methods,
        });
    }
    return classes;
}

/**
 * Runs ABAP Unit tests of one object (class, program, ...). By default only tests with risk level
 * "harmless" run, because dangerous/critical tests may change data on the system.
 */
export async function handleRunUnitTests(args: any) {
    try {
        const objectUrl = args?.object_url ? String(args.object_url) : '';
        if (!objectUrl.startsWith('/sap/bc/adt/')) {
            throw new McpError(ErrorCode.InvalidParams, 'object_url is required and must start with /sap/bc/adt/ (object, not source, e.g. /sap/bc/adt/oo/classes/zcl_foo)');
        }

        const system = args?.sap_system || 'S4H';
        const risky = args?.include_risky === true;

        const body =
            '<?xml version="1.0" encoding="UTF-8"?>' +
            '<aunit:runConfiguration xmlns:aunit="http://www.sap.com/adt/aunit">' +
            '<external><coverage active="false"/></external>' +
            '<options>' +
            '<uriType value="semantic"/>' +
            '<testDeterminationStrategy sameProgram="true" assignedTests="false" appendAssignedTestsPreview="true"/>' +
            `<testRiskLevels harmless="true" dangerous="${risky}" critical="${risky}"/>` +
            '<testDurations short="true" medium="true" long="true"/>' +
            '</options>' +
            '<adtcore:objectSets xmlns:adtcore="http://www.sap.com/adt/core"><objectSet kind="inclusive">' +
            `<adtcore:objectReferences><adtcore:objectReference adtcore:uri="${objectUrl}"/></adtcore:objectReferences>` +
            '</objectSet></adtcore:objectSets>' +
            '</aunit:runConfiguration>';

        const url = `${await getBaseUrl(system)}/sap/bc/adt/abapunit/testruns`;
        const response = await makeAdtRequest(url, 'POST', 300000, body, undefined, system, {
            'Content-Type': 'application/vnd.sap.adt.abapunit.testruns.config.v4+xml',
            'Accept': 'application/vnd.sap.adt.abapunit.testruns.result.v2+xml',
        });

        const xml = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
        const classes = parseClasses(xml);

        // Unknown format: hand back the raw XML instead of a false "no tests".
        if (classes.length === 0 && /<(?:\w+:)?test(?:Class|Method)\b/i.test(xml)) {
            return { content: [{ type: 'text', text: xml }] };
        }

        // Alerts outside of test classes, e.g. kind="noTestClasses" when the object has no tests.
        const generalAlerts = parseAlerts(xml.replace(/<(?:\w+:)?testClass\b[\s\S]*?<\/(?:\w+:)?testClass>/gi, ''));

        const methods = classes.flatMap((c) => c.methods);
        const failed = methods.filter((m) => !m.passed).length;
        const classAlerts = classes.reduce((sum, c) => sum + c.alerts.length, 0);
        const result = {
            object: objectUrl,
            system: String(system).toUpperCase(),
            riskLevels: risky ? 'harmless, dangerous, critical' : 'harmless only',
            ok: failed === 0 && classAlerts === 0 && !generalAlerts.some((a) => a.kind !== 'noTestClasses'),
            testClasses: classes.length,
            testMethods: methods.length,
            passed: methods.length - failed,
            failed,
            alerts: generalAlerts,
            classes,
        };
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
        return return_error(error);
    }
}
