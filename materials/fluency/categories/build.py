"""Build the fluency task's category lists (assets/data/category-animals.txt,
category-fruitveg.txt) from
  - review/classified_*.tsv: the SUBTLEX-CH candidates (candidates.py) judged
    by hand against RULES.md (word<TAB>A or word<TAB>F), and
  - lists/animals_*.txt, lists/fruitveg_*.txt: names listed from knowledge,
    domain by domain, so the lists also hold words SUBTLEX-CH lacks.
The exclusions of RULES.md are applied again here as a guard; a word on both
lists is reported and kept off both until it is settled in BOTH_RESOLVED.
python3 materials/fluency/categories/build.py"""
import glob, os, re, unicodedata
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, '..', '..', '..')
norm = lambda w: re.sub(r'\s+', '', unicodedata.normalize('NFKC', w)).strip()
CJK = re.compile(r'^[㐀-鿿·]+$')
# RULES.md exclusions, checked again
EXCLUDE_AN = set('动物 宠物 家禽 牲畜 野兽 猛兽 害虫 益虫 哺乳动物 爬行动物 两栖动物 鸟类 鱼类 昆虫类 猫科动物 犬科动物 龙 凤凰 麒麟 独角兽 美人鱼 貔貅 饕餮 神兽 人 猎人 牛仔 牛肉 鸡蛋 鸭蛋 鱼翅 猪蹄 牛奶 烤鸭 狗屁 熊孩子 菜鸟 牛逼 野生动物 小动物 家畜 鱼肉 鸡肉 猪肉 羊肉 蛋'.split())
EXCLUDE_FV = set('水果 蔬菜 果蔬 果实 干果 野菜 坚果 果汁 果酱 果冻 泡菜 咸菜 薯条 薯片 番茄酱 豆腐 豆浆 沙拉 米 大米 小米 小麦 面粉 胡椒 花椒 八角 桂皮 孜然 玫瑰 树 草 瓜子 傻瓜 菜鸟 菜单 豆腐渣 菜 果 青菜叶 水果糖 糖果 果仁巧克力 果脯 蜜饯 罐头 粟米'.split())   # 粟米: millet in Mandarin (corn only in Cantonese)
# words on both sides, settled by hand: word -> 'A', 'F' or '' (neither)
BOTH_RESOLVED = {'红虾': 'A'}

def read_lists(prefix):
    out = set()
    for f in sorted(glob.glob(os.path.join(HERE, 'lists', prefix + '*.txt'))):
        out |= {norm(l) for l in open(f, encoding='utf-8') if norm(l) and not l.startswith('#')}
    return out
an, fv = read_lists('animals_'), read_lists('fruitveg_')
for f in sorted(glob.glob(os.path.join(HERE, 'review', 'classified_*.tsv'))):
    for l in open(f, encoding='utf-8'):
        p = l.rstrip('\n').split('\t')
        if len(p) == 2 and norm(p[0]): (an if p[1].strip() == 'A' else fv if p[1].strip() == 'F' else set()).add(norm(p[0]))
bad = {w for w in an | fv if not CJK.match(w)}
an -= bad | EXCLUDE_AN | {w for w in an if w.endswith('类') or w.endswith('动物')}
fv -= bad | EXCLUDE_FV | {w for w in fv if w.endswith('类')}
both = an & fv
for w in both:
    r = BOTH_RESOLVED.get(w)
    if r != 'A': an.discard(w)
    if r != 'F': fv.discard(w)
lex = {l.split('\t')[0] for l in open(os.path.join(ROOT, 'assets/data/subtlex-ch-wf.txt'), encoding='utf-8') if l and l[0] != '#'}
def write(name, words, what):
    body = (f'# Fluency task: {what}, simplified Chinese, one word per line ({len(words)} words; {len(words & lex)} also in SUBTLEX-CH).\n'
            '# Built by materials/fluency/categories/build.py; rules in materials/fluency/categories/RULES.md.\n' + '\n'.join(sorted(words)) + '\n')
    open(os.path.join(ROOT, 'assets/data', name), 'w', encoding='utf-8').write(body)
write('category-animals.txt', an, 'animals')
write('category-fruitveg.txt', fv, 'fruits and vegetables')
print(f'animals {len(an)} ({len(an & lex)} in SUBTLEX-CH) | fruits & vegetables {len(fv)} ({len(fv & lex)} in SUBTLEX-CH) | dropped non-CJK {len(bad)}')
unsettled = sorted(w for w in both if w not in BOTH_RESOLVED)
if unsettled: print('ON BOTH LISTS, kept off both until settled in BOTH_RESOLVED:', ' '.join(unsettled))
