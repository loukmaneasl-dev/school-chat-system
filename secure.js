
const JavaScriptObfuscator = require('javascript-obfuscator');
const fs = require('fs');

console.log("=== جاري تشفير ملف السيرفر ===");

if (!fs.existsSync('server.js')) {
    console.error("خطأ: لم يتم العثور على ملف server.js");
    process.exit(1);
}

const code = fs.readFileSync('server.js', 'utf8');

const obfuscationResult = JavaScriptObfuscator.obfuscate(code, {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 1,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.4,
    debugProtection: false,
    disableConsoleOutput: false,
    identifierNamesGenerator: 'hexadecimal',
    log: false,
    numbersToExpressions: true,
    renameGlobals: false,
    selfDefending: true,
    simplify: true,
    splitStrings: true,
    stringArray: true,
    stringArrayCallsTransform: true,
    stringArrayEncoding: ['rc4'],
    stringArrayIndexShift: true,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayWrappersCount: 1,
    stringArrayWrappersChainedCalls: true,
    stringArrayWrappersParametersMaxCount: 2,
    stringArrayThreshold: 0.75,
    target: 'node',
    unicodeEscapeSequence: false
});

fs.writeFileSync('server-secure.js', obfuscationResult.getObfuscatedCode());

console.log("\n✅ تم التشفير بنجاح!");
console.log("الملف الجديد هو: server-secure.js");
console.log("لتشغيله استخدم: node server-secure.js");
