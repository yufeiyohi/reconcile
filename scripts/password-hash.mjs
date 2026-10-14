import { scryptSync, randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
// Read via stdin; password never goes into a shell argument or command history.
const rl=createInterface({input:process.stdin,terminal:false});
process.stderr.write('从标准输入提供 12–256 字符密码，然后回车（请在可信终端运行）：\n');
rl.once('line',password=>{rl.close();if(password.length<12||password.length>256){process.stderr.write('密码长度无效\n');process.exitCode=1;return;}const salt=randomBytes(16).toString('hex');process.stdout.write(`scrypt$${salt}$${scryptSync(password,salt,64).toString('hex')}\n`);});
