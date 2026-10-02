/*
 * wrestle - one-on-one ragdoll wrestling against a machine, after Bennett
 * Foddy's Get On Top (the Flash version, read out of its SWF: see
 * 3rdp/get-on-top/).
 *
 * The bodies, joints, motors and controls are the original's. Each wrestler is
 * a torso with a head welded on, one arm and one leg, and the two arms are
 * pinned together at the hands. Up (or act) is the leg: held it drives hip,
 * knee and ankle straight, let go it curls them back. Left and right turn the
 * arm against the torso, which leans the body that way and the other one the
 * other way. The wrestlers touch the ground and nothing else. A head on the
 * ground is a point to the other side.
 *
 * The original is two players, first to 11. Here the right wrestler is a
 * machine playing the same three controls, the machine's head down scores,
 * yours costs one of five lives, and the match runs until they are gone.
 * ramp(), stepped each time the player wins a round, makes the machine react
 * sooner and err less.
 *
 * The original is in pixels. Here a pixel is 1/50 of a metre and a mass is 0.4
 * of the original's (Nape stores density over 1000), so every number below is
 * the original's, converted by S and TQ. Its code steps 0.00625 s a frame, but
 * a recording of it falls at 830 px/s² against its gravity of 770, so it ran
 * at real time, and so does this.
 */

import { World } from "./alma/src/rigid.js";
import * as ent from "./lib/entity.js";
import { shake } from "./lib/camera.js";
import { fixed, gameOver, input, ramp, speed } from "./lib/one.js";
import * as sound from "./lib/sound.js";

// The original's own sounds, its MP3s as they came out of the SWF.
sound.file(
  "grunt1",
  "data:audio/mpeg;base64,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nkJda0GljZnV6iBLXTVldtryadtaRrVL1FZWyRKZPKY6ZFJRlPCW3CeZgTJ2sSd42f8c1GoRlxG6sDdCOhGVnYrpkryHLhCoL17FsilGT4FUgzgOpXK6EAsnDQZP4CrO2ta3mZRnnVr7VFovhIGCfSO6BjZ2XbNatmDcI+pacqTZkJNvwS8m49U2v5xpnKSR//tQwMKADF01U6YM0qmRJejo9hh0Nz7noucPkOjwWFCvkGhCA8jgPoXCU7rs9ax0fNJxFSKltFy5bWy46Ay0m43t7MpMYU9V81LVYeFElscY9mWGrGpf8PgEYrP5eZ/+W8tpSzHAX4lWGjwBDOmsNWaxyMmtJllQ1scmVrENY5MoYE5Mscj7KRqwUGhrKTBQqORrLkyyoatHJllQ8pSNQwUGhrKTBQaOhq1kNWqGoYE5GrUjNY6GrA6iJaAAAAAAAAAAAAAAAAAAAAAAAAAAAP/7UMC8AAyRNT1GDNMplKKjyPeYeQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/+1DAtIAJQREGBgxVQT4mmgAwjAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAg//tQwMUAAAABLAAAAAAAACWAAAAAACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgAP/7UMD/gAAAASwAAAAAAAAlgAAAACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgAAA=",
);
sound.file(
  "grunt2",
  "data:audio/mpeg;base64,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ZQ8lGszF/CkUNrbDmiaBCaBHSXc8tI/8peODJy/Pcq0sSclcjtERGgJSVodc0juG64h5dgQoV0Jp4nW2GLs4NnFHrPozYUo5JqRox//7UMC+AA0dL0JMJMupn6YoSPSZVciYyz1MVKW7kp7YVMYkcWgLqPqiKa9kuEWnIqZJ2p1SKkjReEaht+vOtMwAJqeAWR4l7hnE0pBsVTAzaq7vK1fDUwmjBw3oG1Xrd92WUnifEPCaMZts076Xjd+zLNmENNUfuszPpz04Xlbqo7tGxbR4Qy9Hravc7XaISpw+TyTnxguHo82Bgwk11FRjdSWiTGbiqOhRBqStFGnEOYU2pVfZqxaE1brBVjUeQCJZzVwqvIgrzckStpO2Lh3/+1DAswANSTM8J7DJ6a+k50GEoiWeVctRcZMPWVSyZLuigS2TXc7J0QYns9LxUivalEyG2dWuWbjfU0oYxuk0RDHwUcTFEoPMWpQaXKP8Wdg1AvoiOh43NdDiuw4zBYwcE+DM8ceNCdlIJEuBVemkl04baJVrH5XkQZsNbdLp4ck1/cZq5qLpYzPq03dGRpTPCbsge6o2n+xpAiVJpYeHqdKQ7XCKq15CXxVE7uU9JXP/yD0bBKc314AAAFroA4j/UMKxIhDhbhCh6R9aQ1Jy//tQwKUADNU5QEeZEemQJWcE8yI1EoHTEJgqvxK4O3uCkZBSMm76SJJc4GAMlJMlcz6LRaq2XI41dqf1RwCCqNRp/+ckSo1EpJyktaTQkiRRraYsFCZRmflVua1UajMy1WCpHJef2Ol2KgKAASPBbQByNZVPCaJIFFCz1HWpI0qurUmXNrDWGJDBg6OTK1scjJrIZT//NZSNbLDI1kPlJgoYE5MsNQwJxgZEYCioqnSM9ITIgIWAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/7UMCdAA0BKzQsJMeptKRkZPYZGQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACD/+1DAj4AJSN70BhhjwAAAJYAAAAAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAA//tQwMeAAAABLAAAAAAAACWAAAAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAAA==",
);
sound.file(
  "crack",
  "data:audio/mpeg;base64,/+MgwAAAAAJYAAAAAAGswABEg4XQDTMBCGHk793f8Y6FXfRC0RN3eAZoAJQ4s3fQv/6fESoTu8CCCDAnPgg7//////+HxGOBAuFgfKAg74fACAAECBYTcjscse6qDEtY8dDDebmHVw3/4yDAWxDRRbgBRhgAQMSLJHxz+JZnMJXUgs7mABABAMQoISeG8btNa/FglDQbXMeksOWxzp/8acN0UcfwYsONnVbRPilNY1T71q2Pj7//3v/s+2tD7QlZEZ7tsaPealsfWvrXpr/wNf/jIMByKOsS3X+PeiJb3m34n93kkePD97vJot/rX/+96u501q8dwY4+d094G4/vjF73za9JnAgbT/qLv/pwwAARJbb92Kdfp3yQSNYUxCtEsiqskKtlJmHjKxEshIktlIsTSfgnCwYE/+MgwCkTaN7b/8JIAONPggJx58gXgdRw/ahNdrfdIiyjdppiB93/+7d1RmxHS46hiFiSKlQ4Me3Fj99evLLeJcNIceKl3ESrg0WHuZ//9X5H+usNrngVErpUJgqAg7Q55VbizxKsNCL/4yDANg+YBuf2CAACWEw0IlnSowOgqiqob+oxHRsEvHQI6HAMtl9tFmbGQi8U9XTlW/Uv0yy4KnS48BUMtRNCA2OfqCq8M3VJQke5JK9zG3mCTKw2KPoxCPAAwG+pLh////Pg////gP/jIMBSEKi23/gIRm7HBBGwK7u4i7aPHvc/x4e6Mw9OEzAgsLohhNRNMxA9MohUe+3fX3///////////H334e2h0HJ0QknRBZBA9MxA9N02Qc+cdX/saRIEygCW6bXRgLxBEFZaQLID/+MgwGoXCubz+AhMuqanZsNvFduolJCJJURFRUsBREVKjAqdCnkSpY0ddaee4iSqWAgKPc//9MRCICgkhanhIKj7//2npJKAkTTbRMoEcUOGmWcFhMkTzBIjMC7crSp9XQyLNurPW7D/4yDAaBHgAsv+AAAAIzRgKst7lIvDZlSgrWpeto8O//4SFgoTAJhaiSgKFQqkzMlf8YLPa9ag9tmkaSM1ZrGvRP8+Clm0MrkfVJW7PCkKNo7tHksJB1wlOUhK/y1Z0TAyGnh1m6s6wv/jIMB7EmEas/wYRHI//X4TQsVALgWArgkOWNeGorturdLIuFolK+6UCEA6hDEHMJC9dYf1qsFM1WqXSb7/7Gv+YxjG5nUpf6Gfv1o6GfMZsrcxSlL//LK3///v6sZRIwSgqRLREDTz/+MgwIwSgKqf/hjGbKdCtTud0eDR7DoQSGBoQQiMhgdD/yZZQoYGCdHI///qyxyMv8yay1HJlDAwQYGCDoHjQwWb6xUWFhYWF2f///1CYJCwsKhkBBIXFQTMuWwyoXFQAAAAAAAAAAD/4yDAnRL6hnP4CMS2AAAAAAAAAAAAAAAAAAAAAAAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIP/jIMCsEiE1VAAIxpAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAA/+MgwL4AAAJYAAAAACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgAAA=",
);
sound.file(
  "start",
  "data:audio/mpeg;base64,/+MgwAAAAAJYAAAAAC4PS3j1nGiBJBwJkHIMRMi3ibmXCTigjthyGgqFOQcl74CY7oQgCIobM39+Zm9/ovfxYspN7066++MOdSlJm974vLADI8BAAJEFBwyKUy2OwqPyTnvwhBK5d+D/4yDAWxFRJewBT2ABxOolqcQkIw2QDIJ7FjIiWjYpHosZcTTLy0G9aZJlxblwZQxQpmbymbE4OYURxskuir8kzQ3N2pqEJyTSWppo/pGhokaIpE4ThsiYnESZJdFfurlMrjvIAVGSQP/jIMBwKlPO1N+YggK++ggpNiNGTLl/50tL9aZupioZm7smX1GhpLhsaJkTPG59FKkxE/S/63NDRO9//xyC0u6lv/+dUqRAALIOM/4//MRSIBg0DlPgGAQ0lotR///rOpDpB7Lz/////+MgwCEUSybj+dSIA8yLwfMO9J0v///1kaFvi26v///RF+LSYo//67KU/W5iWRSQxqKnRrr//9ltOlciS4CRgDmeuXe4bz3rOpL4FMddZdVWeGK6N1er/7mpaF2AyRaSW////0KjgKj/4yDAKhBaqqXg1JS4t////zWFt////+aMCN////9TSIPf/4IA1AvYa5rXMP7d/OYQ7mz0Dt2McmgY3Wp1WV/650qiQgNpLqV0f///qI4Umjv////HwAv////jYUP////41FH////oOv/jIMBDEPsqmUDcztg+rYA5lc7lcz7W/HHkrCwQdg4kQQ99PMPf7Ohd92/9j7kgTDZGzf//95wTwFUfR////ygPRqz////6hci3///+jC5X////1cmA+A5jlnVrZcsY5Yy50QaSHwhR/+MgwFoRyyaZ4NtO2BB0mqR25aZVdlOdv/1F8thAAL99X7///UHxCpN/r//+JgIjD////8KCD////4yMN///+mVG5ICFAC9fx7z+brau3K8wmSd6wJEZdymbXFCldV7t/1oJhyQKSy3/4yDAbRITJo1A3E7Ystv///zouUXMe////4yCcP3////0HwX48b////NYTyS////+exAww5z+9z3n3e6e/PhYOMZhyy6v2VuO1fuH73xdBT//LpYHcBsJIMp/V//+owCfl9P////iyP/jIMB/EqsuieDVFNhtf////qJUf03////zMqI/////rKJdgYAAAEgEAwFI6XstuhV5l8sj1b/xWEZAVQMZWUNrDceEhCyEDzGdqfmGBeCwyDYB1cegLZjP//x4FwZvjL9W8+ruN0/l/+MgwI8SgyqIoVtoAP+g7/MQiZ/9CX/0L/sg8HBbT+Z5M/+vVf+URv//yf//+XDoAAQWdY63hnhn3lN2eChMzvZDJOprMVcyz///9X/qSdIsgM0omqK3V///6IxglNf+v//6ikNogST/4yDAoBmjytIfmFAA////+kboK////1omrf///+lNgHGAABRz8rNavYv495nekYgED3J8mJX7J47BSTRSs6S1O3/dEzJYKgPYYJNbN///o3SAdQFuJJJf7+3/6imXR2mv////MC6d///jIMCUEtMqrUfaiAD6n//ygHEolAFzmWeOu8wxysxpwQaNDiYmGgs8hQHSYFY1U66KnO1f15NkmEiQDU8yRUpT9f/+qpNgFEFUfUml7L92//MRDCEQ//v//Mig7/+VOf/1G3UABXuc/+MgwKMTqi6d5ttktMNZZZZ65WpXqf85p6EhnAxJoW1kls1a13/10yoUQ+IDZgBzUHper//8kQU0OxTRUv6Tf//YQgJIQf/6//1ojWOR////9SRuZu//lA2AqAvcx3d3jyxnrcxAKMz/4yDArxPCLpFC5SK0cDg00bt6W9aUpSnQQ3d/9yiVQyUBvS6lWzv///0BrhRjT/t1//rUKgKaWP/+j/+6hNRMiz////W49CQb////qWcAjAAsdv9wvbz/PKkibCzBTkxOaRATUcCELf/jIMC7FEqujeLdGrjZzmH96t1K/+s3HmA2A8jySU3///5kBSjzLv////JAcR5f///+xOG06a////50mEsg3////Jc2YKAAAAAchz8KTDP7eEplLYS5oP6jhY4wELKmNinrj2QUPXAJ/+MgwMQT0yqJQNya2AgAKJQMREjwGhWDY4HzgHAcCy0A5PLQMDlYEwcsT2Fj5tF8HKBbgsnwoNgWAoGDASK4RP9NBmTk8fLpRMHkYf9Rc1IMbFcwMi6ILhf/xqEn/LxJcT+gbrKZsgj/4yDAzxQjKonhW2gAJfST/86p0kTcidBSCyVKpsUi+DagXy6iIo/5mgmmcLyv6RdEKjoQLxdNU0100bF4zdT1N//P0Fput//0ky8OkWMRuTp8/1IE0redIyEqIKBUETN/KzTCMZRTgP/jIMDZMLPmkUeaqABZYCJsFvQ9OYmz0v3V//////61HiMEEiRK/////////90ieQLR5P////////9a0jZzYDCYdUbAAAQou2XWgffHzZRappzanRk0ZhCAAwcgEwg4y4dQV+3b/////+MgwHESI2a948igAf//JxTCQkc4v////////+igaHkDf////////+YqNit0jCaJVVSgACEozgQCwLFbNAKqoqCgGpOicLYQgA22ALoPg+lU+/////v//61LcnjJAow8CVZv////////4yDAgxKDbrbkNRrZ/9I6XiWOH3////////+pbGxNY6mA/13gABI66o48W2bvg0xOmvC2Z1LRKwe0CGKBqhpdJFq2ZJX3//////61qmowwFBHeU7f////////sUikMEZGz//////////jIMCUE0tupuIc2tj9jZA0MBD3STACImqwAd+WxWz0rLYxkyfFlAY7WAQFPltJF9b7vSf///t//9SlkQTUCSGGL1v////////U5mPQkRzEkZOv////////s5uUD4zJm5u4/0toAA1I/+MgwKES+2qaQDUa2RO5i9sphWAUGIhVaB01MyiMUDNEQNOCHKKJ4+tD///////6q1S+JIA8hcR0U97N///////2rWZEEOSO4Yxkyv////////c6cWVpASz+uKAAJmtVxKHz/6V9+Nr/4yDAsBOrco4gHRrYDMpjyBuOSM2BhpgA24QaXj6menr7f//+/+/11oOiPUTMAfgsi+pKn////////ss0HuHJE8Niief////////60J1qwLZJMAIqxPB82zJzhlsEpH6SAyodUB+oMP/jIMC8FHtmhkAdGtmYnUxRQTSd/uv///3//9ExMY1DJADERA9nfo///////9T0lF4kCEFiMESJ5fV////////QNE0ygY0A91kgAAVIvqZD2I74RVp4NHUlpMeICCASBhzQKcQ44ZQr/+MgwMUUU2Z6QDUa2anXfvd2//////rqXPhygBpCZjotK////////6uiZjsHmOIzZH////////vlpSTHieHsuYCPVvAJbf8kKojNN7pKapyqkZVIKYgUMgG4QOMGEDkNUemjrZHspv//4yDAzhRbam4gHRrZ+v+3//1rUMUJKABSIIS7Nf////////0iWNRFlRfRV////////9zdNRRKjNAKOTAPz2YBVrzVUM4YY2MSq6SlgUCgbD2CkUPoV0D5iapJLUlrb/////+vasnA6v/jIMDXFRNyYkBFGtkADQxSSTakr///////+qSIwpLpkobt////////9a0Y/FFM0WD/Ov8hNE1LxiXhcxEQMKcAx4cDbOQWUBziWL5skYt66kvqb////+y0DZQkoK6ShmUXvSo//////+MgwN0Uw3JSIDUa2P//XSTYdoWkoEsmiykm////////WiiakkxiePUgEZNNEZ+KWLLKuE1EjTISmvREGEiQIWYch0BgyHZymKiKi+n/T/5imCggYMEcMu/1Cwqz6xUWxYXImQELCor/4yDA5RSjbkIgHRrZxUUa/6hdn/iwsKhkyoXFQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/jIMDtFNtuEAANGtgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/+MgwPQTUXVsAAmEkAAAAAAAAAAAAAAAAAAAAAAAACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACD/4yDA/wAAAlgAAAAAACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgAP/jIMD/AAACWAAAAAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAA",
);

export const meta = {
  title: "wrestle",
  bg: "#25283D",
  fg: "#EDE7D9",
  scoreMax: true,
  date: "2026-09-21",
  dpad: true,
};

const S = 1 / 50;
const TQ = 0.4 * S * S;
const PPM = 80;
const M = 1024 / PPM;
const GROUND = 11.25;
const LIVES = 5;
const COUNT = 0.9; // 3, 2, 1, a third each
const GO = 0.4;
const REST = 1.6; // real seconds from a point to the next count
const SLOW = 0.3; // real seconds of it at a tenth speed
const BOT_DELAY = 0.3; // its fastest reaction, before ramp()
const TIP = 1.0;
const BOT_REACH = 0.2;
const BOT_HOLD = 0.5;
const BOT_KICK = 0.3;
const BOT_MISS = 0.3;
const ROUND_T = 15; // ramp() seconds a round, so round 13 is its three minutes

const LEG_SPEED = 380;
const LEG_FORCE = 1078500 * TQ;
const ARM_SPEED = 2;
const ARM_FORCE = 1868500 * TQ;
const ARM_LOW = 600000 * TQ;
const ARM_FOLLOW = 10;

const MAT_C = "#3E4266";
const MAT_TOP = "#565C8C";
const MAT_LINE = "#4A4F7A";
const YOU = "#4FA3C4";
const YOU_DARK = "#2C6A85";
const BOT = "#D1495B";
const BOT_DARK = "#8B2E3C";
const BAND = "#EDE7D9";

// The left wrestler in the original's pixels, after its -16 root offset. The
// right one is this mirrored about x = 320.
const PARTS = {
  torso: { x: 224.83, y: 245.7, w: 41.24, h: 82.48 },
  head: { x: 224.74, y: 176.59, r: 27.92 },
  thigh: { x: 245.99, y: 283.74, w: 30.93, h: 75.18, angle: -1.1248 },
  calf: { x: 255.34, y: 309.05, w: 30.93, h: 68.47, angle: 0.7422 },
  foot: { x: 236.62, y: 341.83, w: 54.22, h: 20.85, angle: 0.0092 },
  arm: { x: 269.41, y: 218.58, w: 114.35, h: 28.14 },
};

// Body A's anchor, body B's anchor, both local, and B's angle less A's.
const JOINTS = [
  ["torso", "arm", [-5.44, -27.17], [-49.99, 0], -2.3708, 2.0708],
  ["torso", "thigh", [0, 28.14], [-0.12, -23.41], -1.3963, 0.4712],
  ["thigh", "calf", [0.13, 25.13], [-0.09, -19.84], 0, 1.8675],
  ["calf", "foot", [-1.42, 45.64], [-13.21, -0.06], -0.733, 1.0472],
];

let world;
let ground;
let pair;
let lives;
let round;
let won;
let restAt;
let clock;
let camX;
let history;
let botAt;
let react;
let kickEnd;
let answered;
let plan;
let planEnd;
let tip;
let count;
let go;

function at(x, y, side) {
  return [M / 2 + side * (x - 320) * S, GROUND + (y - 352) * S];
}

function makeWrestler(side) {
  const w = { side, leg: null, lean: 0, pose: [] };
  const filter = { category: 2, mask: 1 };
  for (const [name, p] of Object.entries(PARTS)) {
    const [x, y] = at(p.x, p.y, -side);
    const angle = -side * (p.angle ?? 0);
    const b = world.body({ x, y, angle, type: "dynamic" });
    const shape = {
      density: 1,
      friction: name === "foot" ? 2 : 1,
      filter,
    };
    // The head bounces, which only shows once it is off the neck: on it,
    // its first touch of the ground is the point.
    if (p.r) b.circle({ r: p.r * S, restitution: 0.5, ...shape });
    else b.box({ w: p.w * S, h: p.h * S, ...shape });
    w[name] = b;
    w.pose.push([b, x, y, angle]);
  }
  w.skull = w.head.fixtures[0];

  const [nx, ny] = at(226.87, 202.99, -side);
  w.neck = world.weld(w.torso, w.head, { x: nx, y: ny });

  w.joints = JOINTS.map(([a, b, la, lb, lo, hi]) =>
    world.revolute(w[a], w[b], {
      localA: [-side * la[0] * S, la[1] * S],
      localB: [-side * lb[0] * S, lb[1] * S],
      lower: side < 0 ? lo : -hi,
      upper: side < 0 ? hi : -lo,
      motor: true,
      motorSpeed: 0,
      maxMotorTorque: b === "arm"
        ? ARM_LOW
        : b === "foot"
        ? LEG_FORCE / 4
        : LEG_FORCE,
    })
  );
  return w;
}

// The original drives hip, ankle one way and the knee the other, mirrored for
// the right wrestler, and before the first press holds the starting pose.
function drive(w) {
  const [shoulder, hip, knee, ankle] = w.joints;
  if (w.leg !== null) {
    const s = (w.leg ? 1 : -1) * -w.side * LEG_SPEED;
    hip.motorSpeed = s;
    knee.motorSpeed = -s;
    ankle.motorSpeed = s;
  }
  if (w.lean) {
    shoulder.motorSpeed = w.lean * ARM_SPEED;
    shoulder.maxMotorTorque = ARM_FORCE;
    return;
  }
  shoulder.motorSpeed = (w.torso.angle - w.arm.angle) * ARM_FOLLOW;
  shoulder.maxMotorTorque = ARM_LOW;
}

function place() {
  camX = M / 2;
  for (const w of pair) {
    w.leg = null;
    w.lean = 0;
    for (const [body, x, y, angle] of w.pose) {
      body.moveTo(x, y, angle);
      body.velocity(0, 0);
      body.spin = 0;
    }
    if (!w.neck) w.neck = world.weld(w.torso, w.head, w.neckAt);
  }
}

// Both wrestlers grunt on a kick, each in its own voice.
function legTo(w, on) {
  if (on && !w.leg) {
    sound.play(w.voice, { volume: 0.6 });
    w.kickAt = clock;
  }
  w.leg = on;
}

function player(w) {
  const press = input.press;
  const leg = press.up || press.act;
  legTo(w, leg ? true : w.leg === null ? null : false);
  if (input.just.left) w.lean = 1;
  if (input.just.right) w.lean = -1;
  if (w.lean > 0 && !press.left) w.lean = press.right ? -1 : 0;
  if (w.lean < 0 && !press.right) w.lean = press.left ? 1 : 0;
}

// What the machine sees, recorded every step: its own tilt, positive toward
// the player, how much higher its head is, whether its foot is down, and when
// the player last kicked.
function snapshot() {
  const [a, b] = pair;
  return {
    t: clock,
    kickAt: a.kickAt,
    mine: -b.torso.angle,
    above: a.head.y - b.head.y,
    grounded: b.foot.y > GROUND - 0.4,
  };
}

// What the machine is trying, picked by `odds`: a lean and whether to kick
// from what it saw, how long it holds a decision, and how often it answers
// the player's kick. `tip` is how far over it lets itself go before it leans
// back, drawn with each plan; stubborn never leans back.
const PLANS = {
  push: {
    odds: 4,
    hold: 1,
    answer: 0.7,
    act: ({ s, tip, low }) => [s.mine > tip ? -1 : 1, low],
  },
  pull: {
    odds: 2,
    hold: 1.5,
    answer: 0.3,
    act: ({ s, tip }) => [
      s.mine < -tip ? 1 : -1,
      s.grounded && Math.random() < 0.3,
    ],
  },
  wait: {
    odds: 2,
    hold: 1.5,
    answer: 0.9,
    act: () => [Math.random() < 0.3 ? rnd() : 0, false],
  },
  mash: { odds: 2, hold: 0.4, answer: 1, act: ({ s }) => [rnd(), s.grounded] },
  rock: {
    odds: 2,
    hold: 0.8,
    answer: 0.5,
    act: ({ low, w }) => [w.lean > 0 ? -1 : 1, low || Math.random() < 0.5],
  },
  stubborn: { odds: 1, hold: 2, answer: 0.5, act: ({ low }) => [1, low] },
};
function rnd() {
  return Math.random() < 0.5 ? -1 : 1;
}

function pickPlan() {
  const plans = Object.entries(PLANS);
  let n = Math.random() * plans.reduce((t, [, p]) => t + p.odds, 0);
  for (const [name, { odds }] of plans) {
    n -= odds;
    if (n <= 0) return name;
  }
  return "push";
}

// The machine plays as a person does. It decides on what it saw a reaction
// time ago, drawn fresh at each decision and now and then slow, and holds the
// decision until the next one; a kick is one press of its own length, not a
// leg set again every step. Every few seconds it changes what it is trying,
// from PLANS, at random. Some decisions are wrong: it lets go of the lean,
// leans the wrong way, or kicks with its foot in the air. ramp() makes it
// react sooner, decide more often and get fewer wrong, and its plans run
// longer. A machine that read the board every step and never let go of a
// lean could not be beaten.
function bot(w) {
  const r = ramp((round - 1) * ROUND_T);
  history = history.filter((s) => s.t >= clock - 1);
  const seen = history.findLast((s) => s.t <= clock - react);
  if (!seen) return;
  if (clock >= planEnd) {
    plan = pickPlan();
    planEnd = clock + (1.5 + 3 * Math.random()) * Math.sqrt(r);
    tip = TIP * (0.6 + Math.random());
  }
  const { hold, answer, act } = PLANS[plan];
  const kick = () => {
    if (clock < kickEnd + 0.1) return;
    kickEnd = clock + BOT_KICK * (0.5 + Math.random());
  };
  if (seen.kickAt > answered) {
    answered = seen.kickAt;
    if (seen.grounded && Math.random() < answer) kick();
  }
  if (clock < botAt) return legTo(w, clock < kickEnd);
  botAt = clock + BOT_HOLD * hold * (0.4 + Math.random()) / r;
  react = BOT_DELAY * (1 + 1.5 * Math.random() ** 3) / r;
  const low = seen.grounded && seen.above < BOT_REACH;
  const [lean, kicks] = act({ s: seen, tip, low, w });
  const miss = Math.random();
  const wrong = BOT_MISS / r;
  if (miss < wrong / 3) w.lean = 0;
  else if (miss < wrong * 2 / 3) w.lean = -lean;
  else w.lean = lean;
  if (kicks || miss > 1 - wrong / 3) kick();
  legTo(w, clock < kickEnd);
}

function point(loser) {
  restAt = REST;
  speed(0.1);
  shake(0.4);
  sound.play("crack", { volume: 0.5 });
  loser.neck.destroy();
  loser.neck = null;
  // Off the neck, away from the torso and up, spinning.
  const h = loser.head;
  const dx = h.x - loser.torso.x;
  const dy = h.y - loser.torso.y;
  const d = Math.hypot(dx, dy);
  h.velocity(h.vx + 3 * dx / d, Math.min(h.vy, 0) - 5);
  h.spin = 8 * Math.sign(dx);
  const p = loser.head;
  new ent.Particle({
    x: (p.x - camX) * PPM + 512,
    y: p.y * PPM,
    color: loser.side < 0 ? 0x4fa3c4 : 0xd1495b,
    count: 34,
    size: [8, 5],
    speed: [260, 170],
    duration: [0.5, 0.2],
  });

  won = loser.side > 0;
  if (won) {
    ent.addScore(1, (p.x - camX) * PPM + 512, p.y * PPM - 60);
    return;
  }
  lives -= 1;
  if (lives <= 0) gameOver({ score: true });
}

export function init() {
  world?.destroy();
  world = new World({ gravity: { x: 0, y: 770 * S }, sleep: false });
  ent.reset();
  speed(1);

  ground = world.box({
    x: M / 2,
    y: GROUND + 0.32,
    w: 6000 * S,
    h: 0.64,
    friction: 2,
  }).fixtures[0];

  pair = [makeWrestler(-1), makeWrestler(1)];
  // The original picks each wrestler's voice at random, each match.
  for (const w of pair) w.voice = Math.random() < 0.5 ? "grunt1" : "grunt2";
  for (const w of pair) {
    const [x, y] = at(226.87, 202.99, -w.side);
    w.neckAt = { x, y };
  }
  const [hx, hy] = at(320.17, 217.06, 1);
  world.weld(pair[0].arm, pair[1].arm, {
    x: hx,
    y: hy,
    angularHertz: 10,
    angularDamping: 1,
  });

  lives = LIVES;
  round = 1;
  restAt = 0;
  clock = 0;
  camX = M / 2;
  history = [];
  botAt = 0;
  react = BOT_DELAY;
  kickEnd = -1;
  answered = 0;
  planEnd = 0;
  count = COUNT;
  sound.play("start", { volume: 0.4 });
  go = 0;
}

export function update(dt, real) {
  clock += dt;

  if (restAt > 0) {
    restAt -= real;
    if (restAt < REST - SLOW) speed(1);
    if (restAt <= 0) {
      restAt = 0;
      history = [];
      kickEnd = -1;
      answered = clock;
      if (won) round += 1;
      place();
      count = COUNT;
      sound.play("start", { volume: 0.4 });
    }
  }

  go = Math.max(0, go - real);
  // The countdown holds the pair where place() put them, as the original holds
  // its step until GET ON TOP! is typed out.
  if (count > 0) {
    count -= real;
    if (count <= 0) go = GO;
    ent.update(dt);
    return;
  }

  fixed(60, (h) => {
    if (restAt === 0) {
      player(pair[0]);
      history.push(snapshot());
      bot(pair[1]);
    }
    for (const w of pair) drive(w);
    world.step(h, 8);
    if (restAt > 0) return;
    for (const { a, b } of world.began) {
      if (a !== ground && b !== ground) continue;
      const other = a === ground ? b : a;
      const loser = pair.find((w) => w.skull === other);
      if (loser) return point(loser);
    }
  });

  const mid = (pair[0].torso.x + pair[1].torso.x) / 2;
  camX += (mid - camX) * (1 - 0.95 ** (60 * real));

  ent.update(dt);
}

function box(ctx, b, p, fill, edge) {
  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.rotate(b.angle);
  const w = p.w * S;
  const h = p.h * S;
  const r = Math.min(w, h) / 2;
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = edge;
  ctx.lineWidth = 0.06;
  ctx.stroke();
  ctx.restore();
}

function colors(w) {
  return w.side < 0 ? [YOU, YOU_DARK] : [BOT, BOT_DARK];
}

function drawWrestler(ctx, w) {
  const [fill, edge] = colors(w);
  for (const name of ["thigh", "calf", "foot", "torso"]) {
    box(ctx, w[name], PARTS[name], fill, edge);
  }
  const h = w.head;
  const r = PARTS.head.r * S;
  const off = !w.neck;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(h.x, h.y, r, 0, 2 * Math.PI);
  ctx.fill();
  ctx.strokeStyle = edge;
  ctx.lineWidth = 0.06;
  ctx.stroke();
  if (off) return;

  // The headband, on the side of the head facing away from the torso.
  const a = Math.atan2(h.y - w.torso.y, h.x - w.torso.x);
  ctx.strokeStyle = BAND;
  ctx.lineWidth = 0.08;
  ctx.beginPath();
  ctx.arc(h.x, h.y, r * 0.8, a - 1.0, a + 1.0);
  ctx.stroke();
}

export function render(ctx) {
  ctx.save();
  ctx.translate(512, 0);
  ctx.scale(PPM, PPM);
  ctx.translate(-camX, 0);

  const left = camX - M / 2;
  ctx.fillStyle = MAT_C;
  ctx.fillRect(left, GROUND, M, M - GROUND);
  // A mark a metre, so the mat shows the camera moving.
  ctx.fillStyle = MAT_LINE;
  for (let x = Math.floor(left); x < left + M + 1; ++x) {
    ctx.fillRect(x, GROUND + 0.25, 0.5, M - GROUND);
  }
  ctx.fillStyle = MAT_TOP;
  ctx.fillRect(left, GROUND, M, 0.1);

  // The arms go over both bodies, as in the original.
  for (const w of pair) drawWrestler(ctx, w);
  for (const w of pair) box(ctx, w.arm, PARTS.arm, ...colors(w));
  ctx.restore();

  const call = count > 0 ? `${Math.ceil(count / (COUNT / 3))}` : go > 0 ? "GO!" : "";
  if (call) {
    ctx.fillStyle = BAND;
    ctx.text(call, 512, 300, 180, { weight: "bold" });
  }

  ctx.fillStyle = MAT_TOP;
  ctx.text(`ROUND ${round}`, 512, GROUND * PPM + 50, 36, { weight: "bold" });

  // The lives, studded into the mat on the player's own side.
  for (let i = 0; i < LIVES; ++i) {
    ctx.beginPath();
    ctx.arc(48 + i * 36, GROUND * PPM + 50, 10, 0, 2 * Math.PI);
    if (i < lives) {
      ctx.fillStyle = YOU;
      ctx.fill();
      continue;
    }
    ctx.strokeStyle = MAT_TOP;
    ctx.lineWidth = 5;
    ctx.stroke();
  }

  ent.render(ctx);
}
